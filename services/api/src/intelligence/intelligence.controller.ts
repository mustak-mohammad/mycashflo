import { Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  IntelligenceService,
  ExecuteToolDto,
  RejectProposalDto,
  IntelligenceChatDto,
} from './intelligence.service.js';

@ApiTags('Intelligence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('intelligence')
export class IntelligenceController {
  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Get('tools')
  @ApiOperation({ summary: 'Get catalog of AI tools and JSON schemas for LLM function calling' })
  getTools() {
    return this.intelligenceService.getToolDefinitions();
  }

  @Post('tools/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute an AI tool (enforces confirmation guard for consequential actions)' })
  @ApiResponse({ status: 200, description: 'Tool execution result or confirmation requirement' })
  async executeTool(@CurrentUser() user: AuthUser, @Body() dto: ExecuteToolDto) {
    return this.intelligenceService.executeTool(user, dto);
  }

  @Get('actions/pending')
  @ApiOperation({ summary: 'List pending consequential AI action proposals awaiting human approval' })
  async getPendingProposals(@CurrentUser() user: AuthUser) {
    return this.intelligenceService.getPendingProposals(user);
  }

  @Get('actions')
  @ApiOperation({ summary: 'List all action proposals (history)' })
  async getAllProposals(@CurrentUser() user: AuthUser) {
    return this.intelligenceService.getAllProposals(user);
  }

  @Post('actions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve and execute a pending consequential AI action' })
  async approveProposal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.intelligenceService.approveProposal(id, user);
  }

  @Post('actions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending consequential AI action' })
  async rejectProposal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectProposalDto,
  ) {
    return this.intelligenceService.rejectProposal(id, user, dto);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Collections Intelligence natural language assistant' })
  async chat(@CurrentUser() user: AuthUser, @Body() dto: IntelligenceChatDto) {
    return this.intelligenceService.chat(user, dto);
  }
}
