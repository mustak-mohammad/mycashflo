import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { GoogleAuthDto } from './dto/google-auth.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

  // ── Issue JWT pair ─────────────────────────────────────────────────────────
  async issueTokens(userId: string, tenantId: string, role: string) {
    const payload = { sub: userId, tenantId, role };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: 900, // 15 minutes
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: 604800, // 7 days
    });

    // Store refresh token hash in DB so it can be revoked
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { token: tokenHash, userId, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  // ── Hash password helper (used by seed) ───────────────────────────────────
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
}
