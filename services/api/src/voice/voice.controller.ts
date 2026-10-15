import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  VoiceService,
  VoiceTokenDto,
  ConversationTurnDto,
  StartRecordingDto,
  StopRecordingDto,
} from './voice.service.js';
import type { ConversationTurnResult } from './voice.service.js';

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

  @Post('recording/start')
  @ApiOperation({ summary: 'Start recording a LiveKit room (audio-only) via egress' })
  startRecording(@CurrentUser() user: AuthUser, @Body() dto: StartRecordingDto) {
    return this.voiceService.startRecording(user, dto);
  }

  @Post('recording/stop')
  @ApiOperation({ summary: 'Stop an in-flight room recording' })
  stopRecording(@CurrentUser() user: AuthUser, @Body() dto: StopRecordingDto) {
    return this.voiceService.stopRecording(user, dto);
  }

  @Post('conversation/turn')
  @ApiOperation({ summary: 'Process a turn in the 10-stage Chotu AI collection conversation' })
  processTurn(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConversationTurnDto,
  ): Promise<ConversationTurnResult> {
    return this.voiceService.processTurn(user, dto);
  }
}

