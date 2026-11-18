import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const THROTTLE_CONFIG_KEY = 'rate_limit_throttle_config';

export interface ThrottleConfig {
  limit: number;
  ttlSeconds: number;
}

/** Decorator to override rate limit for specific endpoints */
export const Throttle = (config: ThrottleConfig) => SetMetadata(THROTTLE_CONFIG_KEY, config);

interface BucketEntry {
  timestamps: number[];
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly buckets = new Map<string, BucketEntry>();
  private lastPruneTime = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    // Skip throttling for internal health and metrics checks
    const url: string = req.originalUrl || req.url || '';
    if (url.includes('/api/health') || url.includes('/favicon.ico')) {
      return true;
    }

    // Determine client IP
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp: string =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
      req.socket?.remoteAddress ||
      'unknown-ip';

    // Route category and tier limits
    const routeConfig = this.resolveRouteConfig(url, context);
    const { limit, ttlSeconds } = routeConfig;
    const windowMs = ttlSeconds * 1000;
    const now = Date.now();

    // Memory garbage collection every 60 seconds
    if (now - this.lastPruneTime > 60_000) {
      this.pruneExpiredBuckets(now);
    }

    // Bucket key: IP + category prefix
    const bucketKey = `${clientIp}:${this.getCategoryKey(url)}`;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(bucketKey, bucket);
    }

    // Filter out timestamps outside the sliding window
    const windowStart = now - windowMs;
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

    const remaining = Math.max(0, limit - bucket.timestamps.length);
    const oldestTimestamp = bucket.timestamps[0] ?? now;
    const resetSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

    // Attach standard rate limit headers to response if res is available
    if (res?.setHeader) {
      res.setHeader('RateLimit-Limit', limit.toString());
      res.setHeader('RateLimit-Remaining', Math.max(0, remaining - 1).toString());
      res.setHeader('RateLimit-Reset', resetSeconds.toString());
    }

    if (bucket.timestamps.length >= limit) {
      this.logger.warn(`Rate limit exceeded for IP ${clientIp} on ${url} (${limit} req / ${ttlSeconds}s)`);
      if (res?.setHeader) {
        res.setHeader('Retry-After', resetSeconds.toString());
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${resetSeconds} seconds.`,
          retryAfter: resetSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Record request timestamp
    bucket.timestamps.push(now);
    return true;
  }

  private resolveRouteConfig(url: string, context: ExecutionContext): ThrottleConfig {
    // 1. Check method/class decorator override
    const override = this.reflector.getAllAndOverride<ThrottleConfig>(THROTTLE_CONFIG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (override) {
      return override;
    }

    // 2. Sensitive Auth endpoints: 20 requests / 60 seconds (brute-force defense while supporting multi-tab startup)
    if (
      url.includes('/api/auth/login') ||
      url.includes('/api/auth/refresh') ||
      url.includes('/api/auth/forgot-password') ||
      url.includes('/api/auth/reset-password') ||
      url.includes('/api/auth/change-password')
    ) {
      return { limit: 20, ttlSeconds: 60 };
    }

    // 3. Payment order & verification endpoints: 20 requests / 60 seconds
    if (url.includes('/api/payments/razorpay/order') || url.includes('/api/payments/razorpay/verify')) {
      return { limit: 20, ttlSeconds: 60 };
    }

    // 4. Outbound notifications & telephony: 30 requests / 60 seconds
    if (url.includes('/api/notifications/dispatch') || url.includes('/api/calls/initiate')) {
      return { limit: 30, ttlSeconds: 60 };
    }

    // 5. Default standard API limit: 120 requests / 60 seconds
    return { limit: 120, ttlSeconds: 60 };
  }

  private getCategoryKey(url: string): string {
    if (url.includes('/api/auth/')) return 'auth';
    if (url.includes('/api/payments/')) return 'payment';
    if (url.includes('/api/notifications/')) return 'notif';
    if (url.includes('/api/calls/')) return 'calls';
    return 'general';
  }

  private pruneExpiredBuckets(now: number) {
    this.lastPruneTime = now;
    const maxWindow = 120_000; // 2 minutes
    for (const [key, bucket] of this.buckets.entries()) {
      bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < maxWindow);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  /** Reset in-memory rate limit buckets (primarily for isolated test suites) */
  reset() {
    this.buckets.clear();
  }
}
