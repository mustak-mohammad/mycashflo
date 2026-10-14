import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { VoiceService, VoiceTokenDto } from './voice.service.js';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('token')
  @ApiOperation({ summary: 'Request a LiveKit room token for Chotu AI voice session' })
  generateToken(@CurrentUser() user: AuthUser, @Body() dto: VoiceTokenDto) {
    return this.voiceService.generateToken(user, dto);
  }
}
