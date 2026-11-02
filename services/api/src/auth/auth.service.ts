import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { GoogleAuthDto } from './dto/google-auth.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshPromises = new Map<
    string,
    Promise<{ tokens: { accessToken: string; refreshToken: string; expiresIn: number } }>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Login ──────────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    // Find user by email across tenants (email+tenantId is unique, but for
    // login we search by email alone — the tenant is embedded in the JWT)
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, isActive: true },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user.id, user.tenantId, user.role);

    this.logger.log(`User ${user.email} logged in (tenant: ${user.tenantId})`);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      },
      tokens,
    };
  }

  // ── Get Authenticated User Profile ─────────────────────────────────────────
  async getProfile(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { tenant: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
      },
    };
  }

  // ── Update Authenticated User Profile (Display Name) ────────────────────────
  async updateProfile(userId: string, tenantId: string, dto: { name?: string }) {
    const cleanName = (dto.name || '').trim();
    if (!cleanName) {
      throw new BadRequestException('Display name cannot be empty');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { tenant: true },
    });
    if (!existingUser) {
      throw new UnauthorizedException('User not found in tenant');
    }

    const previousName = existingUser.name;

    // Persist only the display name — strictly prevent modifying role, tenant, or email
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: cleanName },
      include: { tenant: true },
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'user.profile_updated',
          entityType: 'User',
          entityId: userId,
          metadata: {
            previousName,
            newName: cleanName,
          },
        },
      });
    } catch (auditErr) {
      this.logger.warn(`Failed to audit log profile update: ${(auditErr as Error).message}`);
    }

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      tenantId: updated.tenantId,
      tenant: {
        id: updated.tenant.id,
        name: updated.tenant.name,
        slug: updated.tenant.slug,
      },
    };
  }

  // ── Google Sign In / Sign Up ───────────────────────────────────────────────
  async googleAuth(dto: GoogleAuthDto) {
    let email: string;
    let name: string;

    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');

    // If real Google ID token, verify via Google's tokeninfo API
    if (!dto.idToken.startsWith('mock_')) {
      try {
        const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`;
        const res = await fetch(verifyUrl);
        if (!res.ok) {
          throw new UnauthorizedException('Invalid Google ID token');
        }
        const data = await res.json();
        if (data.email_verified !== 'true' && data.email_verified !== true) {
          throw new UnauthorizedException('Google email is not verified');
        }
        if (googleClientId && data.aud !== googleClientId) {
          throw new UnauthorizedException('Google token audience mismatch');
        }
        email = data.email;
        name = data.name || email.split('@')[0];
      } catch (err: any) {
        if (err instanceof UnauthorizedException) throw err;
        throw new UnauthorizedException(`Failed to verify Google token: ${err.message}`);
      }
    } else {
      // Development mock token fallback
      const parts = dto.idToken.split(':');
      email = dto.email || (parts.length > 1 ? parts[1] : 'google.user@democorp.in');
      name = dto.name || (parts.length > 2 ? parts[2] : (dto.email ? dto.email.split('@')[0] : 'Google User'));
    }

    // Check if user already exists
    let user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { tenant: true },
    });

    // If new user, create a new Tenant and User (Sign Up flow)
    if (!user) {
      const companyName = `${name}'s Organization`;
      const baseSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      const slug = `${baseSlug}-${Date.now().toString(36)}`;

      const tenant = await this.prisma.tenant.create({
        data: {
          name: companyName,
          slug,
        },
      });

      const randomHash = await bcrypt.hash(Date.now().toString() + Math.random().toString(), 12);
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: randomHash,
          role: 'ADMIN',
          tenantId: tenant.id,
        },
        include: { tenant: true },
      });

      this.logger.log(`New user registered via Google: ${email} (Tenant: ${tenant.name})`);
    } else {
      this.logger.log(`Existing user authenticated via Google: ${email}`);
    }

    const tokens = await this.issueTokens(user.id, user.tenantId, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      },
      tokens,
    };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ── Issue JWT pair ─────────────────────────────────────────────────────────
  async issueTokens(userId: string, tenantId: string, role: string) {
    const payload = { sub: userId, tenantId, role, jti: crypto.randomUUID() };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: 3600, // 1 hour
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: 604800, // 7 days
    });

    // Store deterministic SHA-256 token hash in DB so it can be indexed and safely queried
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { token: tokenHash, userId, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600, // 1 hour in seconds
    };
  }

  // ── Refresh Tokens with Rotation and Reuse Detection ──────────────────────
  async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    // If an identical refresh request is already currently in-flight, return the shared promise
    if (this.refreshPromises.has(tokenHash)) {
      this.logger.log(
        `Awaiting in-flight concurrent refresh for token hash prefix ${tokenHash.substring(0, 8)}...`,
      );
      return this.refreshPromises.get(tokenHash)!;
    }

    const refreshPromise = this.performTokenRefresh(rawRefreshToken, tokenHash);
    this.refreshPromises.set(tokenHash, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      this.refreshPromises.delete(tokenHash);
    }
  }

  private async performTokenRefresh(rawRefreshToken: string, tokenHash: string) {
    // 1. Verify Signature and Expiry with Configured Refresh Secret
    let payload: any;
    try {
      payload = this.jwt.verify(rawRefreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch (err: any) {
      this.logger.warn(`Refresh token JWT verification failed: ${err.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const userId = payload?.sub;
    if (!userId) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // 2. Match token hash in database (with bcrypt fallback for legacy sessions)
    let storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    if (!storedToken) {
      const userTokens = await this.prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      for (const candidate of userTokens) {
        if (
          candidate.token.startsWith('$2') &&
          (await bcrypt.compare(rawRefreshToken, candidate.token))
        ) {
          storedToken = candidate;
          break;
        }
      }
    }

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    // 3. Reject Revoked or Reused Tokens
    if (storedToken.revoked) {
      // Token reuse detection: Invalidate all active sessions for this user to mitigate compromise
      await this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });
      this.logger.warn(
        `Security alert: Revoked refresh token presented for user ${userId}. All user sessions invalidated.`,
      );
      throw new UnauthorizedException('Refresh token has been revoked or reused');
    }

    // 4. Reject Expired Tokens
    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // 5. Atomic Token Rotation within Database Transaction
    return await this.prisma.$transaction(async (tx) => {
      // Mark current token as revoked
      await tx.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });

      // Verify active user
      const user = await tx.user.findFirst({
        where: { id: userId, isActive: true },
      });
      if (!user) {
        throw new UnauthorizedException('User account not found or inactive');
      }

      // Generate rotated token pair
      const newPayload = { sub: user.id, tenantId: user.tenantId, role: user.role, jti: crypto.randomUUID() };
      const newAccessToken = this.jwt.sign(newPayload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET') as string,
        expiresIn: 3600,
      });

      const newRefreshToken = this.jwt.sign(newPayload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') as string,
        expiresIn: 604800,
      });

      const newTokenHash = this.hashToken(newRefreshToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: { token: newTokenHash, userId: user.id, expiresAt },
      });

      this.logger.log(`Refresh token successfully rotated for user ${user.id}`);

      return {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 3600,
        },
      };
    });
  }

  // ── Logout & Session Revocation ──────────────────────────────────────────
  async logout(userId: string, rawRefreshToken?: string) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      // If no specific refresh token is provided, revoke all active sessions for this user
      const updated = await this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });
      this.logger.log(`All active sessions revoked for user ${userId} (revoked count: ${updated.count})`);
      return { success: true, revokedCount: updated.count };
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    if (!stored) {
      // Idempotent: token already expired, purged or not found
      return { success: true, message: 'Session already terminated' };
    }

    // Validate ownership: strictly prevent cross-user session revocation
    if (stored.userId !== userId) {
      this.logger.warn(`Security alert: User ${userId} attempted to revoke session belonging to user ${stored.userId}`);
      throw new ForbiddenException('Cannot revoke session belonging to another user');
    }

    if (!stored.revoked) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
      });
      this.logger.log(`Session revoked for user ${userId} (token hash prefix ${tokenHash.substring(0, 8)}...)`);
    }

    return { success: true };
  }

  // ── Hash password helper (used by seed) ───────────────────────────────────
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
}
