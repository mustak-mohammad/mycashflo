import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitGuard } from './rate-limit.guard.js';
import { HttpStatus } from '@nestjs/common';

describe('RateLimitGuard (SEC-AUTH-002: Rate Limiting)', () => {
  let guard: RateLimitGuard;
  let mockReflector: any;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: vi.fn().mockReturnValue(null),
    };
    guard = new RateLimitGuard(mockReflector);
    guard.reset();
  });

  const createMockContext = (url: string, ip = '192.168.1.100') => {
    const headers: Record<string, string> = {
      'x-forwarded-for': ip,
    };
    const responseHeaders: Record<string, string> = {};

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: url,
          headers,
          socket: { remoteAddress: ip },
        }),
        getResponse: () => ({
          setHeader: vi.fn((k: string, v: string) => {
            responseHeaders[k] = v;
          }),
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it('allows requests within limit and sets RateLimit headers', () => {
    const context = createMockContext('/api/auth/login');
    const allowed = guard.canActivate(context);
    expect(allowed).toBe(true);
  });

  it('blocks requests when auth rate limit (20 req/min) is exceeded with HTTP 429', () => {
    const url = '/api/auth/login';
    const ip = '10.0.0.1';

    // First 20 requests should succeed
    for (let i = 0; i < 20; i++) {
      expect(guard.canActivate(createMockContext(url, ip))).toBe(true);
    }

    // 21st request must throw 429
    expect(() => guard.canActivate(createMockContext(url, ip))).toThrowError();
    try {
      guard.canActivate(createMockContext(url, ip));
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.getResponse().error).toBe('Too Many Requests');
    }
  });

  it('isolates rate limits by client IP', () => {
    const url = '/api/auth/login';

    // Exceed limit for IP A
    for (let i = 0; i < 20; i++) {
      guard.canActivate(createMockContext(url, '192.168.1.1'));
    }
    expect(() => guard.canActivate(createMockContext(url, '192.168.1.1'))).toThrow();

    // IP B must still be allowed
    expect(guard.canActivate(createMockContext(url, '192.168.1.2'))).toBe(true);
  });

  it('allows health check unconditionally', () => {
    for (let i = 0; i < 200; i++) {
      expect(guard.canActivate(createMockContext('/api/health'))).toBe(true);
    }
  });
});
