import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ChotuService } from './chotu.service.js';
import { ChotuChatRequestDto, ChotuChatResponseDto } from './dto/chotu-chat.dto.js';

@ApiTags('Chotu AI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chotu')
export class ChotuController {
  constructor(private readonly chotuService: ChotuService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conversational assistant for tenant records, collection intelligence, and navigation guidance',
  })
  @ApiResponse({
    status: 200,
    description: 'Assistant reply with contextual follow-up questions',
    type: ChotuChatResponseDto,
  })
  async chat(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChotuChatRequestDto,
  ): Promise<ChotuChatResponseDto> {
    return this.chotuService.processChat(user, dto);
  }
}
