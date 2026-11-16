import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  iat: number;
  exp: number;
}

/**
 * Validates the JWT access token on every protected request.
 * Enforces durable, persistent token invalidation via database-backed tokensValidAfter.
 * Attaches the verified user identity to req.user.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const nodeEnv = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').toLowerCase();
    const isProd = nodeEnv === 'production';
    const isTest = nodeEnv === 'test';
    const configuredSecret =
      config.get<string>('JWT_ACCESS_SECRET') ?? process.env.JWT_ACCESS_SECRET;

    if ((!configuredSecret || configuredSecret.trim() === '') && (isProd || !isTest)) {
      throw new Error('JWT_ACCESS_SECRET is required and cannot use a fallback secret');
    }

    const secretOrKey =
      configuredSecret && configuredSecret.trim() !== ''
        ? configuredSecret
        : crypto.randomBytes(32).toString('hex');

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey,
    });
  }

  async validate(payload: JwtPayload) {
    // 1. Persistent, cross-instance user status and revocation check
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        tenantId: true,
        isActive: true,
        tokensValidAfter: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    // 2. Validate JWT issuance timestamp against persistent tokensValidAfter
    if (user.tokensValidAfter && payload.iat) {
      const validAfterSec = Math.floor(user.tokensValidAfter.getTime() / 1000);
      if (payload.iat < validAfterSec) {
        throw new UnauthorizedException('Access token has been revoked due to password change or session termination');
      }
    }

    // 3. Return verified user identity for req.user
    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };
  }
}
