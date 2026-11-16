import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  VoiceService,
  VoiceTokenDto,
  AgentDispatchDto,
  ConversationTurnDto,
  StartRecordingDto,
  StopRecordingDto,
} from './voice.service.js';
import {
  DocumentDeliveryService,
  CreateDocumentDeliveryDto,
  DocumentDeliveryQueryDto,
} from './document-delivery.service.js';
import type {
  ConversationTurnResult,
  InitialGreetingDto,
  InitialGreetingResult,
  StructuredCallSummary,
} from './voice.service.js';

@ApiTags('voice')
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly documentDeliveryService: DocumentDeliveryService,
  ) {}

  @Post('initial-greeting')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Resolve verified customer-facing initial prompt and conversation goal' })
  getInitialGreeting(
    @CurrentUser() user: AuthUser,
    @Body() dto: InitialGreetingDto,
  ): Promise<InitialGreetingResult> {
    return this.voiceService.getInitialGreeting(user, dto);
  }

  @Post('summary')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate structured post-call summary and validated commitments' })
  generateStructuredSummary(
    @CurrentUser() user: AuthUser,
    @Body() dto: any,
  ): StructuredCallSummary {
    return this.voiceService.generateStructuredCallSummary(dto);
  }

  @Post('token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request a LiveKit room token for Chotu AI voice session' })
  generateToken(@CurrentUser() user: AuthUser, @Body() dto: VoiceTokenDto) {
    return this.voiceService.generateToken(user, dto);
  }

  @Post('dispatch')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Dispatch Chotu AI agent worker to a LiveKit room' })
  dispatchAgent(@CurrentUser() user: AuthUser, @Body() dto: AgentDispatchDto) {
    return this.voiceService.dispatchAgent(user, dto);
  }

  @Get('health')
  @ApiOperation({ summary: 'LiveKit Cloud connection and configuration health check' })
  checkHealth() {
    return this.voiceService.checkLiveKitHealth();
  }

  @Post('recording/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Start recording a LiveKit room (audio-only) via egress' })
  startRecording(@CurrentUser() user: AuthUser, @Body() dto: StartRecordingDto) {
    return this.voiceService.startRecording(user, dto);
  }

  @Post('recording/stop')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Stop an in-flight room recording' })
  stopRecording(@CurrentUser() user: AuthUser, @Body() dto: StopRecordingDto) {
    return this.voiceService.stopRecording(user, dto);
  }

  @Post('conversation/turn')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Process a turn in the 10-stage Chotu AI collection conversation' })
  processTurn(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConversationTurnDto,
  ): Promise<ConversationTurnResult> {
    return this.voiceService.processTurn(user, dto);
  }

  @Get('synthesize')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Synthesize speech audio for Chotu AI voice prompts & replies' })
  async synthesizeSpeech(
    @Query('text') text: string,
    @Res() res: Response,
  ) {
    const audioBuffer = await this.voiceService.synthesizeSpeech(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(audioBuffer);
  }

  @Post('webhook/livekit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'LiveKit room and participant lifecycle webhook' })
  handleLiveKitWebhook(
    @Req() req: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const rawBody = req.rawBody || req.body;
    return this.voiceService.handleLiveKitWebhook(rawBody, authHeader);
  }

  @Post('document-requests')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request invoice and/or payment link delivery via WhatsApp and/or Email' })
  requestDocumentDelivery(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDeliveryDto,
    @Req() req: Request,
  ) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    return this.documentDeliveryService.requestDelivery(user, dto, baseUrl);
  }

  @Get('document-requests')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List customer document delivery requests for current tenant' })
  getDocumentDeliveryRequests(
    @CurrentUser() user: AuthUser,
    @Query() query: DocumentDeliveryQueryDto,
  ) {
    return this.documentDeliveryService.findAll(user, query);
  }

  @Get('document-requests/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get details of a document delivery request and its channel attempts' })
  getDocumentDeliveryRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.documentDeliveryService.findOne(id, user);
  }

  @Post('document-requests/:id/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel a customer document delivery request' })
  cancelDocumentDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.documentDeliveryService.cancelDelivery(user, id);
  }

  @Get('document-requests/invoices/:id/download')
  @ApiOperation({ summary: 'Download invoice PDF using a short-lived cryptographically signed token' })
  async downloadSignedInvoicePdf(
    @Param('id') id: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.documentDeliveryService.getSecureInvoicePdf(id, token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.end(buffer);
  }
}


