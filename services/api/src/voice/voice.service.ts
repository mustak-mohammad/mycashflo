import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VoiceTokenDto {
  @ApiPropertyOptional({ example: 'cust_123', description: 'Customer ID for the collection call' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: 'case_123', description: 'Collection case ID' })
  @IsOptional()
  @IsString()
  collectionCaseId?: string;
}

@Injectable()
export class VoiceService {
  constructor(private readonly config: ConfigService) {}

  async generateToken(user: AuthUser, dto: VoiceTokenDto) {
    const livekitUrl = this.config.get<string>('LIVEKIT_URL');
    const livekitApiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const livekitApiSecret = this.config.get<string>('LIVEKIT_API_SECRET');

    const roomName = `mcf-${user.tenantId}-${dto.customerId ?? 'general'}-${Date.now().toString(36)}`;
    const participantName = `Agent (${user.role})`;
    const participantIdentity = `agent-${user.userId}`;

    // If real LiveKit credentials exist, we can sign or return LiveKit config
    const isMock = !livekitApiKey || !livekitApiSecret || livekitApiKey === 'placeholder';

    // Generates a mock or placeholder JWT token for LiveKit client / mock agent
    const token = Buffer.from(
      JSON.stringify({
        sub: participantIdentity,
        name: participantName,
        room: roomName,
        tenantId: user.tenantId,
        customerId: dto.customerId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity
        mode: isMock ? 'mock' : 'live',
      }),
    ).toString('base64url');

    return {
      token,
      roomName,
      url: livekitUrl || 'wss://demo-livekit.mycashflo.in',
      identity: participantIdentity,
      name: participantName,
      isMock,
      expiresIn: 3600,
    };
  }
}
