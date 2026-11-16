import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  WebhookReceiver,
  EgressStatus,
} from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecorderService } from './recorder.service.js';
import { DocumentDeliveryService } from './document-delivery.service.js';
import {
  claimWebhookReplayKey,
  pruneExpiredWebhookReplays,
  DEFAULT_WEBHOOK_REPLAY_TTL_MS,
} from '../common/webhook-replay.util.js';
import {
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsString, IsObject, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ConversationStage =
  | 'GREETING_AND_VERIFICATION'
  | 'CONFIRM_BALANCE'
  | 'ASK_FULL_PAYMENT'
  | 'NEGOTIATE_AMOUNT'
  | 'ASK_PAYMENT_DATE'
  | 'ASK_DELAY_REASON'
  | 'PAYMENT_METHOD'
  | 'ASSISTANCE_CHECK'
  | 'SUMMARIZE_COMMITMENT'
  | 'CLOSING'
  | 'CALLBACK_SCHEDULED'
  | 'DISPUTE_LOGGED'
  | 'TRANSFERRED_TO_AGENT'
  | 'CALL_ENDED';

export type ChotuIntent =
  | 'NO_CONTACT'
  | 'HUMAN_REQUEST'
  | 'CALLBACK_REQUEST'
  | 'RESUME_CONVERSATION'
  | 'DISPUTE'
  | 'ALREADY_PAID'
  | 'REFUSAL'
  | 'CANNOT_PAY'
  | 'PARTIAL_PAYMENT_PROPOSAL'
  | 'EXPLICIT_PROMISE'
  | 'VAGUE_LATER'
  | 'WHO_IS_CALLING'
  | 'WHY_CALLING'
  | 'DOCUMENT_OR_LINK_REQUEST'
  | 'SEND_INVOICE'
  | 'SEND_PAYMENT_LINK'
  | 'SEND_INVOICE_AND_PAYMENT_LINK'
  | 'SELECT_DELIVERY_CHANNEL'
  | 'CANCEL_DOCUMENT_REQUEST'
  | 'PAYMENT_OPTIONS_INQUIRY'
  | 'CLARIFICATION_OR_REPEAT'
  | 'GREETING_OR_IDENTITY'
  | 'UNRELATED_OR_CHAT'
  | 'AFFIRMATION'
  | 'NEGATION'
  | 'UNCLEAR_OR_LOW_CONFIDENCE';

export interface TurnHistoryItem {
  role: 'customer' | 'agent' | 'system';
  text: string;
  timestamp: string;
  intent?: ChotuIntent;
}

export interface ConversationContextData {
  customerId?: string;
  customerName: string;
  customerCompany?: string;
  outstandingAmount: string;
  invoiceNumber: string;
  invoiceDueDate?: string;
  history: TurnHistoryItem[];
  turnCount: number;
  conversationalGoal: string;
  confirmedFacts: Record<string, any>;
  unresolvedQuestions: string[];
  commitmentStatus: 'NONE' | 'TENTATIVE' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  canPay: 'YES' | 'NO' | 'UNKNOWN';
  willingToPay: 'WILLING' | 'UNWILLING' | 'UNKNOWN';
  tentativeTimeframe?: string;
  agreedAmount?: string | null;
  promisedDate?: string | null;
  paymentMethod?: string | null;
  delayReason?: string | null;
  hardshipReason?: string | null;
  disputeReason?: string | null;
  refusalReason?: string | null;
  claimedAmount?: string | null;
  claimedDate?: string | null;
  claimedUtrOrRef?: string | null;
  callbackTime?: string | null;
  awaitingConfirmation?: boolean;
  humanRequested?: boolean;
  callbackRequested?: boolean;
  paymentClaimed?: boolean;
  isDispute?: boolean;
  willPayLater?: boolean;
  resendRequested?: boolean;
  paymentMethodPreference?: string;
  linkAuthorizationRequested?: boolean;
  awaitingInvoiceSelection?: boolean;
  pendingDocumentRequest?: {
    requestType: DocumentRequestType;
    deliveryChannel: DeliveryChannelPreference;
  } | null;
  lastDocumentDeliveryId?: string | null;
  deliveryChannelPreference?: DeliveryChannelPreference;
  documentDelivery?: {
    requestType: DocumentRequestType;
    invoiceNumber: string;
    deliveryChannel: DeliveryChannelPreference;
    status: DocumentDeliveryStatus | 'CANCELLED';
    attempts?: any[];
  } | null;
}

export type CallType = 'COLLECTIONS' | 'DISPUTE' | 'CALLBACK';

export interface InitialGreetingDto {
  callType?: CallType;
  customerId?: string;
  invoiceId?: string;
  promptId?: string;
}

export interface InitialGreetingResult {
  greeting: string;
  callType: CallType;
  conversationalGoal: string;
  customerName: string;
  outstandingAmount: string;
  invoiceNumber: string;
  dueDate: string;
  companyName: string;
  promptId?: string;
  promptName?: string;
}

export interface StructuredCallSummary {
  customerName: string;
  customerId?: string;
  invoiceNumber?: string;
  callDateTime: string;
  durationSeconds: number;
  formattedDuration: string;
  callType: CallType;
  reasonForCall: string;
  customerMainResponse: string;
  outcomeCategory: string;
  paymentCommitment: 'NONE' | 'TENTATIVE' | 'CONFIRMED';
  commitmentAmount?: string | null;
  commitmentDate?: string | null;
  paymentMethod?: string | null;
  customerReportedPayment?: {
    claimedAmount?: string | null;
    claimedDate?: string | null;
    utrOrReference?: string | null;
  } | null;
  disputeDetails?: {
    reason?: string | null;
    disputedAmount?: string | null;
  } | null;
  callbackRequest?: {
    requestedTime?: string | null;
    preferredContact?: string | null;
  } | null;
  humanHandoffRequested: boolean;
  noContactStatus?: {
    isNoContact: boolean;
    reason?: string | null;
  } | null;
  nextAction: string;
  shortSummary: string;
  documentDelivery?: {
    requestType: string;
    invoiceNumber: string;
    deliveryChannel: string;
    status: string;
    attempts?: Array<{
      channel: string;
      destinationMasked: string;
      status: string;
      errorMessage?: string | null;
    }>;
  } | null;
}

export class VoiceTokenDto {
  @ApiPropertyOptional({ example: 'cust_123', description: 'Customer ID for the collection call' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: 'case_123', description: 'Collection case ID' })
  @IsOptional()
  @IsString()
  collectionCaseId?: string;

  @ApiPropertyOptional({ example: 'mcf-room-xyz', description: 'Optional specific LiveKit room name' })
  @IsOptional()
  @IsString()
  roomName?: string;

  @ApiPropertyOptional({ example: 900, description: 'Token TTL in seconds (default: 900s / 15m, max: 3600s)' })
  @IsOptional()
  @IsNumber()
  ttlSeconds?: number;

  @ApiPropertyOptional({ enum: ['AGENT', 'CUSTOMER', 'OBSERVER'], default: 'AGENT' })
  @IsOptional()
  @IsString()
  role?: 'AGENT' | 'CUSTOMER' | 'OBSERVER';
}

export class AgentDispatchDto {
  @ApiProperty({ description: 'Target LiveKit room name for Chotu AI voice agent' })
  @IsString()
  roomName: string;

  @ApiPropertyOptional({ description: 'Agent worker name', default: 'chotu-voice-agent' })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ description: 'Custom dispatch metadata or context' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class ConversationTurnDto {
  @ApiProperty({ description: 'Customer utterance speech-to-text text' })
  @IsString()
  userSpeech: string;

  @ApiProperty({ description: 'Current stage of conversation flow' })
  @IsString()
  currentStage: ConversationStage;

  @ApiPropertyOptional({ description: 'Customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Invoice ID' })
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @ApiPropertyOptional({ description: 'Voice prompt ID to use for greeting/tone' })
  @IsOptional()
  @IsString()
  promptId?: string;

  @ApiPropertyOptional({ description: 'Call session ID for database state persistence' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Extracted conversation metadata so far' })
  @IsOptional()
  @IsObject()
  extractedData?: Record<string, any>;

  @ApiPropertyOptional({ enum: ['COLLECTIONS', 'DISPUTE', 'CALLBACK'], default: 'COLLECTIONS' })
  @IsOptional()
  @IsString()
  callType?: CallType;

  @ApiPropertyOptional({ description: 'Turn count' })
  @IsOptional()
  @IsNumber()
  turnCount?: number;
}

export interface ConversationTurnResult {
  reply: string;
  nextStage: ConversationStage;
  shouldEnd: boolean;
  outcome?: string;
  extractedData: Record<string, any>;
  actionExecuted?: string;
}

export class StartRecordingDto {
  @ApiProperty({ description: 'LiveKit room name to record' })
  @IsString()
  roomName: string;

  @ApiPropertyOptional({ description: 'Call session id to attach the recording to' })
  @IsOptional()
  @IsString()
  callSessionId?: string;
}

export class StopRecordingDto {
  @ApiProperty({ description: 'Egress job id returned when recording started' })
  @IsString()
  egressId: string;

  @ApiPropertyOptional({ description: 'Call session id to mark as processing' })
  @IsOptional()
  @IsString()
  callSessionId?: string;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly ttsCache = new Map<string, Buffer>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly recorder: RecorderService,
    @Optional() private readonly documentDeliveryService?: DocumentDeliveryService,
  ) {}

  async generateToken(user: AuthUser, dto: VoiceTokenDto) {
    const livekitUrl = this.config.get<string>('LIVEKIT_URL');
    const livekitApiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const livekitApiSecret = this.config.get<string>('LIVEKIT_API_SECRET');

    const role = dto.role || 'AGENT';
    // Short-lived token with minimum permissions: default 900s (15m), bounded between 60s and 3600s
    const ttlSeconds = Math.max(60, Math.min(dto.ttlSeconds || 900, 3600));

    const roomName =
      dto.roomName ||
      `mcf-${user.tenantId}-${dto.customerId ?? 'general'}-${Date.now().toString(36)}`;

    let participantName = `Agent (${user.role})`;
    let participantIdentity = `agent-${user.userId}`;

    if (role === 'CUSTOMER') {
      participantName = 'Customer Participant';
      participantIdentity = `customer-${dto.customerId || Date.now()}`;
    } else if (role === 'OBSERVER') {
      participantName = `Supervisor (${user.name || user.role})`;
      participantIdentity = `observer-${user.userId}`;
    }

    const metadataObj = {
      tenantId: user.tenantId,
      userId: user.userId,
      customerId: dto.customerId,
      collectionCaseId: dto.collectionCaseId,
      role,
    };

    const isPlaceholder = (val?: string) =>
      !val ||
      typeof val !== 'string' ||
      val.trim() === '' ||
      val === 'placeholder' ||
      val.startsWith('your_') ||
      val.includes('your-project.livekit.cloud') ||
      val.includes('placeholder_');

    if (
      isPlaceholder(livekitUrl) ||
      isPlaceholder(livekitApiKey) ||
      isPlaceholder(livekitApiSecret)
    ) {
      this.logger.warn('LiveKit token generation rejected: LiveKit credentials are not configured');
      throw new ServiceUnavailableException('LiveKit voice service is not configured');
    }

    let token = '';
    try {
      const at = new AccessToken(livekitApiKey!, livekitApiSecret!, {
        identity: participantIdentity,
        name: participantName,
        ttl: `${ttlSeconds}s`,
        metadata: JSON.stringify(metadataObj),
      });
      at.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: role !== 'OBSERVER',
        canSubscribe: true,
        canPublishData: role === 'AGENT',
        hidden: role === 'OBSERVER',
      });
      token = await at.toJwt();
      if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
        throw new Error('Signed token format invalid');
      }
    } catch {
      // Never log raw error strings that could include API keys or signing secrets
      this.logger.error(`Failed to sign LiveKit access token for room '${roomName}'`);
      throw new InternalServerErrorException('Failed to generate LiveKit access token');
    }

    return {
      token,
      roomName,
      url: livekitUrl!,
      identity: participantIdentity,
      name: participantName,
      isMock: false,
      expiresIn: ttlSeconds,
      role,
    };
  }

  /**
   * Dispatch Chotu AI Voice Agent worker to a LiveKit room.
   * Production always requires valid LiveKit credentials and fails closed on dispatch error.
   * Development simulation requires explicit ALLOW_DEV_LIVEKIT_SIMULATION=true and non-production NODE_ENV.
   */
  async dispatchAgent(user: AuthUser, dto: AgentDispatchDto) {
    const livekitApiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const livekitApiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    const livekitUrl = this.config.get<string>('LIVEKIT_URL');

    const configEnv = this.config.get<string>('NODE_ENV');
    const procEnv = process.env.NODE_ENV;
    const isProd =
      configEnv?.trim().toLowerCase() === 'production' ||
      procEnv?.trim().toLowerCase() === 'production';

    const allowDevSimulationFlag =
      this.config.get<string>('ALLOW_DEV_LIVEKIT_SIMULATION') ??
      process.env.ALLOW_DEV_LIVEKIT_SIMULATION ??
      'false';
    const allowDevSimulation =
      !isProd && String(allowDevSimulationFlag).trim().toLowerCase() === 'true';

    const isPlaceholder = (val?: string) =>
      !val ||
      typeof val !== 'string' ||
      val.trim() === '' ||
      val === 'placeholder' ||
      val.startsWith('your_') ||
      val.includes('your-project.livekit.cloud') ||
      val.includes('placeholder_');

    const missingCreds =
      isPlaceholder(livekitUrl) ||
      isPlaceholder(livekitApiKey) ||
      isPlaceholder(livekitApiSecret);

    const agentName =
      dto.agentName || this.config.get<string>('LIVEKIT_AGENT_NAME') || 'chotu-voice-agent';

    const metadata = {
      tenantId: user.tenantId,
      userId: user.userId,
      dispatchedAt: new Date().toISOString(),
      ...(dto.metadata || {}),
    };

    if (missingCreds) {
      if (allowDevSimulation) {
        const mockDispatchId = `disp_sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.logger.log(
          `[SIMULATION] Chotu AI Agent dispatch simulated for room '${dto.roomName}' (Dispatch ID: ${mockDispatchId})`,
        );
        return {
          dispatchId: mockDispatchId,
          roomName: dto.roomName,
          agentName,
          status: 'DISPATCHED_SIMULATED',
          isSimulated: true,
        };
      }

      this.logger.warn(
        `LiveKit agent dispatch rejected for room '${dto.roomName}': LiveKit credentials are not configured`,
      );
      throw new ServiceUnavailableException('LiveKit agent dispatch is not configured');
    }

    try {
      const host = livekitUrl!.replace(/^ws/, 'http');
      const client = new AgentDispatchClient(host, livekitApiKey!, livekitApiSecret!);
      const dispatch = await client.createDispatch(dto.roomName, agentName, {
        metadata: JSON.stringify(metadata),
      });

      if (!dispatch || !dispatch.id) {
        throw new Error('Empty dispatch response');
      }

      this.logger.log(
        `Dispatched Chotu agent '${agentName}' to room '${dto.roomName}' (Dispatch ID: ${dispatch.id})`,
      );
      return {
        dispatchId: dispatch.id,
        roomName: dto.roomName,
        agentName,
        status: 'DISPATCHED',
        isSimulated: false,
      };
    } catch {
      // Never fall back to simulation on dispatch failure; never expose credentials in errors or logs
      this.logger.error(
        `Failed to dispatch Chotu agent '${agentName}' to room '${dto.roomName}'`,
      );
      throw new BadRequestException('Failed to dispatch LiveKit agent');
    }
  }

  /**
   * Check LiveKit Cloud connectivity health without leaking secrets.
   */
  checkLiveKitHealth() {
    const livekitUrl = this.config.get<string>('LIVEKIT_URL');
    const livekitApiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const livekitApiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    const agentName = this.config.get<string>('LIVEKIT_AGENT_NAME') || 'chotu-voice-agent';
    const webhookSecret = this.config.get<string>('LIVEKIT_WEBHOOK_SECRET');
    const egressBucket = this.config.get<string>('LIVEKIT_EGRESS_S3_BUCKET');
    const egressPath = this.config.get<string>('LIVEKIT_EGRESS_PATH') || 'recordings';

    const isPlaceholder = (v?: string) =>
      !v || v.startsWith('your_') || v.includes('placeholder') || v.trim() === '';
    const isConfigured =
      !isPlaceholder(livekitApiKey) && !isPlaceholder(livekitApiSecret) && !isPlaceholder(livekitUrl);

    let maskedUrl = 'wss://your-project.livekit.cloud';
    if (livekitUrl && !isPlaceholder(livekitUrl)) {
      try {
        const parsed = new URL(livekitUrl);
        maskedUrl = `${parsed.protocol}//${parsed.hostname.slice(0, 4)}...${parsed.hostname.slice(-8)}`;
      } catch {
        maskedUrl = 'wss://configured.livekit.cloud';
      }
    }

    return {
      configured: isConfigured,
      status: isConfigured ? 'HEALTHY' : 'UNCONFIGURED',
      url: maskedUrl,
      agentName,
      webhookConfigured: !isPlaceholder(webhookSecret),
      egressConfigured: !isPlaceholder(egressBucket) || Boolean(egressPath),
      egressStorage: egressBucket ? 'S3-Compatible Object Store' : 'LiveKit Project Default',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Resolve authoritative customer-facing initial spoken greeting and conversation objective.
   * Strictly verifies call purpose, tenant data, and ensures collections calls never load dispute instructions.
   */
  async getInitialGreeting(user: AuthUser, dto: InitialGreetingDto): Promise<InitialGreetingResult> {
    const { tenantId } = user;
    const callType: CallType = dto.callType || 'COLLECTIONS';

    let customerName = 'Valued Client';
    let companyName = 'Customer';
    let outstandingAmount = 'outstanding balance';
    let invoiceNumber = 'INV-CURRENT';
    let dueDate = 'immediate';

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      });
      if (customer) {
        customerName = customer.name;
        companyName = customer.company || customer.name;
        outstandingAmount = `₹${Number(customer.outstandingBalance).toLocaleString('en-IN')}`;
      }
    }

    if (dto.invoiceId) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, tenantId },
      });
      if (invoice) {
        invoiceNumber = invoice.number;
        outstandingAmount = `₹${Number(invoice.outstanding).toLocaleString('en-IN')}`;
        dueDate = invoice.dueDate.toISOString().slice(0, 10);
      }
    } else if (dto.customerId) {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          customerId: dto.customerId,
          tenantId,
          status: { in: ['OVERDUE', 'OPEN', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
      });
      if (invoice) {
        invoiceNumber = invoice.number;
        outstandingAmount = `₹${Number(invoice.outstanding).toLocaleString('en-IN')}`;
        dueDate = invoice.dueDate.toISOString().slice(0, 10);
      }
    }

    let customPrompt: any = null;
    if (dto.promptId) {
      customPrompt = await this.prisma.voicePrompt.findFirst({
        where: { id: dto.promptId, tenantId },
      });
    }

    // Safety check: category compatibility guard
    if (customPrompt) {
      const cat = (customPrompt.category || '').toUpperCase();
      const isDisputeCategory = cat === 'DISPUTE';
      const isCollectionsCategory = cat === 'COLLECTIONS' || cat === 'OVERDUE' || cat === 'COURTESY';

      // Collections calls must NEVER load a dispute prompt template
      if (callType === 'COLLECTIONS' && isDisputeCategory) {
        this.logger.warn(`Rejected incompatible dispute prompt '${customPrompt.name}' for collections call`);
        customPrompt = null;
      } else if (callType === 'DISPUTE' && !isDisputeCategory) {
        this.logger.warn(`Rejected incompatible non-dispute prompt '${customPrompt.name}' for dispute call`);
        customPrompt = null;
      } else if (callType === 'CALLBACK' && isDisputeCategory) {
        this.logger.warn(`Rejected incompatible dispute prompt '${customPrompt.name}' for callback call`);
        customPrompt = null;
      }
    }

    // Never read internal system prompt instructions verbatim to the customer!
    const isSystemDirective = (text: string) => {
      const lower = text.toLowerCase();
      return (
        lower.startsWith('you are chotu') ||
        lower.includes('rules:') ||
        lower.includes('your objective') ||
        lower.includes('accounts reconciliation specialist') ||
        lower.includes('listen carefully to') ||
        lower.includes('log an official dispute for same-day')
      );
    };

    let greeting = '';
    let conversationalGoal = '';

    if (customPrompt && customPrompt.promptText) {
      const interpolated = customPrompt.promptText
        .replace(/\{\{customerName\}\}/g, customerName)
        .replace(/\{\{outstandingAmount\}\}/g, outstandingAmount)
        .replace(/\{\{invoiceNumber\}\}/g, invoiceNumber)
        .replace(/\{\{dueDate\}\}/g, dueDate)
        .replace(/\{\{companyName\}\}/g, companyName);

      if (isSystemDirective(customPrompt.promptText)) {
        // Use as internal conversational goal / strategy for the agent, not the customer-facing spoken line
        conversationalGoal = interpolated;
      } else {
        // Conversational template provided by operator
        greeting = interpolated;
      }
    }

    if (!greeting) {
      if (callType === 'COLLECTIONS') {
        greeting = `Namaste! Am I speaking with the accounts department at ${customerName}? This is Chotu from myCashFlo regarding the pending balance of ${outstandingAmount}. Is this a convenient time to speak?`;
        if (!conversationalGoal) {
          conversationalGoal = `Verify invoice balance of ${outstandingAmount}, negotiate payment commitments, and confirm a Promise-to-Pay.`;
        }
      } else if (callType === 'DISPUTE') {
        greeting = `Namaste! Am I speaking with the accounts department at ${customerName}? This is Chotu from myCashFlo regarding your billing query on invoice ${invoiceNumber}. I am here to help reconcile any discrepancies or register an official dispute for management review. Could you share the details of the issue?`;
        if (!conversationalGoal) {
          conversationalGoal = `Capture specific item discrepancies, quantity mismatches, or missing credit notes on ${invoiceNumber}, and log an official dispute for review.`;
        }
      } else if (callType === 'CALLBACK') {
        greeting = `Namaste! Am I speaking with ${customerName}? This is Chotu from myCashFlo following up on your requested callback. Is this a convenient time to speak, or would you like me to connect you directly with a representative?`;
        if (!conversationalGoal) {
          conversationalGoal = `Follow up on customer callback request, resolve questions, or arrange human handoff.`;
        }
      }
    }

    return {
      greeting,
      callType,
      conversationalGoal,
      customerName,
      outstandingAmount,
      invoiceNumber,
      dueDate,
      companyName,
      promptId: customPrompt?.id,
      promptName: customPrompt?.name,
    };
  }

  /**
   * Generates a comprehensive, factual, structured post-call summary.
   * Strictly enforces safety: no hallucinated promises, no assumed dates or amounts.
   */
  generateStructuredCallSummary(params: {
    customerName?: string;
    customerId?: string;
    invoiceNumber?: string;
    durationSeconds?: number;
    callType?: CallType;
    outcome?: string;
    context?: Record<string, any>;
    conversationContext?: Record<string, any>;
    transcript?: Array<{ speaker: string; text: string }> | string;
    callDateTime?: string;
  }): StructuredCallSummary {
    const ctx = params.context || params.conversationContext || {};
    const custName = params.customerName || ctx.customerName || 'Valued Client';
    const invNum = params.invoiceNumber || ctx.invoiceNumber || 'INV-CURRENT';
    const durSec = params.durationSeconds || 0;
    const durFormatted = `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}`;
    const callType: CallType = params.callType || ctx.callType || 'COLLECTIONS';
    const outcome = params.outcome || 'OTHER';
    const callDate = params.callDateTime || new Date().toISOString();

    // Parse transcript to check customer engagement
    let customerUtterances: string[] = [];
    if (Array.isArray(params.transcript)) {
      customerUtterances = params.transcript
        .filter((t) => t.speaker === 'customer' || t.speaker === 'user')
        .map((t) => t.text.trim())
        .filter((t) => t.length > 0);
    } else if (typeof params.transcript === 'string') {
      const lines = params.transcript.split('\n');
      customerUtterances = lines
        .filter((l) => /\[(CUSTOMER|USER)\]/i.test(l))
        .map((l) => l.replace(/\[(CUSTOMER|USER)\]:?\s*/i, '').trim())
        .filter((l) => l.length > 0);
    }

    // A call is incomplete / insufficient if duration < 5 seconds OR zero customer utterances
    const hasCustomerEngagement = customerUtterances.length > 0 && durSec >= 5;

    // Reason for call
    let reasonForCall = `Collection follow-up regarding pending invoice ${invNum}`;
    if (callType === 'DISPUTE') {
      reasonForCall = `Invoice dispute and reconciliation inquiry for invoice ${invNum}`;
    } else if (callType === 'CALLBACK') {
      reasonForCall = `Customer requested callback follow-up`;
    }

    // Determine payment commitment strictly without hallucinations
    let paymentCommitment: 'NONE' | 'TENTATIVE' | 'CONFIRMED' = 'NONE';
    let commitmentAmount: string | null = null;
    let commitmentDate: string | null = null;
    let paymentMethod: string | null = null;

    if (
      ctx.commitmentStatus === 'CONFIRMED' &&
      ctx.agreedAmount &&
      ctx.promisedDate &&
      ctx.promisedDate !== 'date pending'
    ) {
      paymentCommitment = 'CONFIRMED';
      commitmentAmount = ctx.agreedAmount;
      commitmentDate = ctx.promisedDate;
      paymentMethod = ctx.paymentMethod || 'Electronic Transfer';
    } else if (
      outcome === 'WILL_PAY_LATER' ||
      ctx.willPayLater ||
      ctx.commitmentStatus === 'TENTATIVE' ||
      ctx.tentativeTimeframe
    ) {
      paymentCommitment = 'TENTATIVE';
      commitmentAmount = null;
      commitmentDate = ctx.tentativeTimeframe || null;
      paymentMethod = ctx.paymentMethod || null;
    }

    // Customer-reported payment claim
    let customerReportedPayment: StructuredCallSummary['customerReportedPayment'] = null;
    if (outcome === 'PAYMENT_CLAIMED' || ctx.paymentClaimed || ctx.claimedUtrOrRef) {
      customerReportedPayment = {
        claimedAmount: ctx.claimedAmount || ctx.outstandingAmount || null,
        claimedDate: ctx.claimedDate || null,
        utrOrReference: ctx.claimedUtrOrRef || 'Pending bank verification',
      };
      paymentCommitment = 'NONE';
    }

    // Dispute details
    let disputeDetails: StructuredCallSummary['disputeDetails'] = null;
    if (outcome === 'DISPUTE' || ctx.isDispute || ctx.disputeReason) {
      disputeDetails = {
        reason: ctx.disputeReason || 'Discrepancy reported on invoice line items or billing',
        disputedAmount: ctx.disputedAmount || null,
      };
      paymentCommitment = 'NONE';
    }

    // Callback request
    let callbackRequest: StructuredCallSummary['callbackRequest'] = null;
    if (outcome === 'CALLBACK_REQUESTED' || ctx.callbackRequested || ctx.callbackTime) {
      callbackRequest = {
        requestedTime: ctx.callbackTime || 'Time not specified',
        preferredContact: ctx.preferredContact || null,
      };
    }

    // Human handoff
    const humanHandoffRequested = Boolean(ctx.humanRequested || ctx.humanHandoffRequested);

    // No contact / refusal
    let noContactStatus: StructuredCallSummary['noContactStatus'] = null;
    if (outcome === 'NO_CONTACT' || ctx.noContact || ctx.refusalReason) {
      noContactStatus = {
        isNoContact: true,
        reason: ctx.refusalReason || 'Customer unavailable or requested no contact',
      };
    }

    // Document delivery status
    const docDelivery = ctx.documentDelivery || params.context?.documentDelivery || null;

    // Customer Main Response
    let customerMainResponse = 'No customer speech recorded.';
    if (!hasCustomerEngagement) {
      customerMainResponse = 'Insufficient information: call disconnected before customer engagement.';
    } else if (paymentCommitment === 'CONFIRMED') {
      customerMainResponse = `Confirmed payment commitment of ${commitmentAmount} by ${commitmentDate} via ${paymentMethod}.`;
    } else if (paymentCommitment === 'TENTATIVE') {
      customerMainResponse = `Expressed intent to pay later (${ctx.tentativeTimeframe || 'date pending follow-up'}) without confirmed date commitment.`;
    } else if (customerReportedPayment) {
      customerMainResponse = `Claimed prior payment (${customerReportedPayment.claimedAmount || 'full balance'}) with UTR/reference: ${customerReportedPayment.utrOrReference}.`;
    } else if (disputeDetails) {
      customerMainResponse = `Raised billing dispute: ${disputeDetails.reason}.`;
    } else if (callbackRequest) {
      customerMainResponse = `Requested callback at ${callbackRequest.requestedTime}.`;
    } else if (humanHandoffRequested) {
      customerMainResponse = `Requested direct transfer to a senior finance representative.`;
    } else if (noContactStatus) {
      customerMainResponse = `Refused payment or requested no contact: ${noContactStatus.reason}.`;
    } else if (outcome === 'UNABLE_TO_PAY' || ctx.canPay === 'NO') {
      customerMainResponse = `Reported cash flow hardship / inability to pay: ${ctx.hardshipReason || 'financial constraints'}.`;
    } else if (docDelivery) {
      if (docDelivery.status === 'CANCELLED') {
        customerMainResponse = `Customer cancelled document delivery request for invoice #${docDelivery.invoiceNumber}.`;
      } else {
        const typeLabel = docDelivery.requestType === 'BOTH' ? 'invoice and payment link' : docDelivery.requestType.toLowerCase().replace('_', ' ');
        customerMainResponse = `Requested ${typeLabel} for invoice #${docDelivery.invoiceNumber} delivered via ${docDelivery.deliveryChannel} (${docDelivery.status}).`;
      }
    } else if (customerUtterances.length > 0) {
      customerMainResponse = customerUtterances[customerUtterances.length - 1];
    }

    // Next Action
    let nextAction = 'Review account status and schedule standard AR follow-up.';
    if (!hasCustomerEngagement) {
      nextAction = 'Verify customer phone number and re-attempt contact during business hours.';
    } else if (paymentCommitment === 'CONFIRMED') {
      nextAction = `Track bank credit for ${commitmentAmount} on ${commitmentDate}; send payment reminder receipt.`;
    } else if (paymentCommitment === 'TENTATIVE') {
      nextAction = `Follow up on ${ctx.tentativeTimeframe || 'upcoming week'} to convert tentative intent into firm commitment.`;
    } else if (customerReportedPayment) {
      nextAction = `Reconcile bank statement for UTR ${customerReportedPayment.utrOrReference || 'reference'} and confirm clearance with finance.`;
    } else if (disputeDetails) {
      nextAction = `Forward dispute details to billing team for immediate review and provide revised invoice or credit note.`;
    } else if (callbackRequest) {
      if (callbackRequest.requestedTime === 'Time not specified') {
        nextAction = 'Callback requested; time not specified—confirm a suitable time.';
      } else {
        nextAction = `Place callback to customer at ${callbackRequest.requestedTime}.`;
      }
    } else if (humanHandoffRequested) {
      nextAction = 'Route call record to senior human collection agent for priority personal outreach.';
    } else if (noContactStatus) {
      nextAction = 'Flag account DND/No Contact per compliance rules and escalate to account manager.';
    } else if (outcome === 'UNABLE_TO_PAY') {
      nextAction = 'Assess hardship request and evaluate payment plan or installment schedule.';
    } else if (docDelivery) {
      if (docDelivery.status === 'CANCELLED') {
        nextAction = 'Review customer request notes; follow up on account balance per standard schedule.';
      } else {
        const typeLabel = docDelivery.requestType === 'BOTH' ? 'invoice and payment link' : docDelivery.requestType.toLowerCase().replace('_', ' ');
        nextAction = `Verify customer receipt of ${typeLabel} for #${docDelivery.invoiceNumber} and track remittance.`;
      }
    }

    // Short Summary
    let shortSummary = '';
    if (!hasCustomerEngagement) {
      shortSummary = `Insufficient information: call with ${custName} (${invNum}) ended before customer response was received.`;
    } else if (paymentCommitment === 'CONFIRMED') {
      shortSummary = `PTP Confirmed: ${custName} agreed to pay ${commitmentAmount} by ${commitmentDate} via ${paymentMethod}.`;
    } else if (paymentCommitment === 'TENTATIVE') {
      shortSummary = `Tentative Intent: ${custName} indicated intent to remit (${ctx.tentativeTimeframe || 'later'}), follow-up needed.`;
    } else if (customerReportedPayment) {
      shortSummary = `Payment Claimed: ${custName} stated invoice was already paid (Ref: ${customerReportedPayment.utrOrReference}), awaiting reconciliation.`;
    } else if (disputeDetails) {
      shortSummary = `Dispute Logged: ${custName} disputed invoice ${invNum} (${disputeDetails.reason}), management review required.`;
    } else if (callbackRequest) {
      if (callbackRequest.requestedTime === 'Time not specified') {
        shortSummary = `Callback Requested: ${custName} requested a callback (time not specified).`;
      } else {
        shortSummary = `Callback Requested: ${custName} requested follow-up at ${callbackRequest.requestedTime}.`;
      }
    } else if (humanHandoffRequested) {
      shortSummary = `Escalation: ${custName} requested human agent handoff.`;
    } else if (noContactStatus) {
      shortSummary = `No Contact / Refusal: ${custName} declined communication (${noContactStatus.reason}).`;
    } else if (outcome === 'UNABLE_TO_PAY') {
      shortSummary = `Financial Hardship: ${custName} reported inability to pay (${ctx.hardshipReason || 'cash flow constraints'}).`;
    } else if (docDelivery) {
      if (docDelivery.status === 'CANCELLED') {
        shortSummary = `Document Request Cancelled: ${custName} cancelled delivery for #${docDelivery.invoiceNumber}.`;
      } else {
        shortSummary = `Document Request: Dispatched ${docDelivery.requestType} for #${docDelivery.invoiceNumber} via ${docDelivery.deliveryChannel} (${docDelivery.status}).`;
      }
    } else {
      shortSummary = `Call with ${custName} completed with outcome: ${outcome} (${durFormatted}).`;
    }

    // Final outcome category: NEVER infer PROMISE_TO_PAY without an explicit customer commitment
    let finalOutcomeCategory = outcome;
    if (callbackRequest && outcome !== 'DISPUTE') {
      finalOutcomeCategory = 'CALLBACK_REQUESTED';
    } else if (finalOutcomeCategory === 'PROMISE_TO_PAY' && paymentCommitment !== 'CONFIRMED') {
      finalOutcomeCategory = paymentCommitment === 'TENTATIVE' ? 'WILL_PAY_LATER' : 'OTHER';
    }

    return {
      customerName: custName,
      customerId: params.customerId || ctx.customerId,
      invoiceNumber: invNum,
      callDateTime: callDate,
      durationSeconds: durSec,
      formattedDuration: durFormatted,
      callType,
      reasonForCall,
      customerMainResponse,
      outcomeCategory: finalOutcomeCategory,
      paymentCommitment,
      commitmentAmount,
      commitmentDate,
      paymentMethod,
      customerReportedPayment,
      disputeDetails,
      callbackRequest,
      humanHandoffRequested,
      noContactStatus,
      nextAction,
      shortSummary,
      documentDelivery: docDelivery
        ? {
            requestType: docDelivery.requestType,
            invoiceNumber: docDelivery.invoiceNumber,
            deliveryChannel: docDelivery.deliveryChannel,
            status: docDelivery.status,
            attempts: docDelivery.attempts || [],
          }
        : null,
    };
  }

  /**
   * Secure Webhook verification and persistent replay-protected event processing for LiveKit room/call events.
   */
  async handleLiveKitWebhook(rawBody: Buffer | string, authHeader?: string) {
    const isProd = process.env.NODE_ENV === 'production';
    const webhookSecret =
      this.config.get<string>('LIVEKIT_WEBHOOK_SECRET') ||
      this.config.get<string>('LIVEKIT_API_SECRET');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');

    // 1. Simulation signature support for test environments
    const isSimulationSig =
      authHeader === 'mock_valid_signature' || authHeader === 'sim_test_signature';
    if (isSimulationSig) {
      if (isProd) {
        this.logger.warn('[LiveKitWebhook] Simulation signature rejected in production');
        throw new UnauthorizedException('Simulation signatures forbidden in production');
      }
      let parsedEvent: any;
      try {
        parsedEvent = JSON.parse(bodyString);
      } catch {
        throw new BadRequestException('Malformed JSON webhook body');
      }
      return this.processParsedWebhookEvent(parsedEvent, bodyString);
    }

    // 2. Production / Real Signature Verification (authentication MUST succeed before replay claim)
    const isMissingOrPlaceholder = (v?: string) =>
      !v || v.trim() === '' || v.includes('placeholder') || v.startsWith('your_');

    if (isProd && (isMissingOrPlaceholder(webhookSecret) || isMissingOrPlaceholder(apiKey))) {
      this.logger.error('[LiveKitWebhook] Webhook credentials not configured in production');
      throw new UnauthorizedException('LiveKit webhook secret is not configured in production');
    }

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header on LiveKit webhook request');
    }

    if (isMissingOrPlaceholder(webhookSecret) || isMissingOrPlaceholder(apiKey)) {
      throw new UnauthorizedException('LiveKit webhook credentials are not configured');
    }

    let event: any;
    try {
      const receiver = new WebhookReceiver(apiKey!, webhookSecret!);
      event = await receiver.receive(bodyString, authHeader);
    } catch {
      this.logger.warn('[LiveKitWebhook] Webhook verification failed');
      throw new UnauthorizedException('Invalid LiveKit webhook signature');
    }

    return this.processParsedWebhookEvent(event, bodyString);
  }

  private async processParsedWebhookEvent(event: any, rawBodyString = '') {
    const fallbackDigest = crypto
      .createHash('sha256')
      .update(
        `${event.event || 'unknown'}|${event.room?.name || ''}|${event.egressInfo?.egressId || ''}|${event.participant?.sid || ''}|${event.createdAt || ''}|${rawBodyString}`,
      )
      .digest('hex');

    const eventId = event.id || `lk_${fallbackDigest}`;
    const replayKey = `LIVEKIT_WEBHOOK:id:${eventId}`;
    const roomName = event.room?.name;
    const eventType = event.event;

    const runInTransaction = async <T>(work: (tx: any) => Promise<T>): Promise<T> => {
      if (typeof this.prisma.$transaction === 'function') {
        return this.prisma.$transaction(work);
      }
      return work(this.prisma);
    };

    const result = await runInTransaction(async (tx) => {
      // Atomic shared PostgreSQL replay claim + CallSession mutations inside one transaction.
      // If any DB update throws or crashes, the replay claim rolls back so a retry can succeed.
      const claimed = await claimWebhookReplayKey(
        tx,
        'LIVEKIT_WEBHOOK',
        replayKey,
        DEFAULT_WEBHOOK_REPLAY_TTL_MS,
      );

      if (!claimed) {
        this.logger.warn(
          `[LiveKitWebhook] Duplicate or replayed webhook event rejected: ${eventId}`,
        );
        throw new UnauthorizedException('Duplicate or replayed LiveKit webhook rejected');
      }

      this.logger.log(`[LiveKitWebhook] Processing event '${eventType}' for room '${roomName || 'N/A'}'`);

      if (roomName) {
        const session = await tx.callSession.findFirst({
          where: {
            OR: [{ livekitRoom: roomName }, { livekitRoom: `sip-${roomName}` }],
          },
        });

        if (session) {
          if (eventType === 'room_started' && !session.startedAt) {
            await tx.callSession.update({
              where: { id: session.id },
              data: { startedAt: new Date() },
            });
          } else if (eventType === 'room_finished') {
            const endedAt = new Date();
            const startedAt = session.startedAt || new Date();
            const duration = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
            await tx.callSession.update({
              where: { id: session.id },
              data: {
                endedAt,
                duration: session.duration || duration,
              },
            });
          } else if (eventType === 'egress_started' && event.egressInfo?.egressId) {
            await tx.callSession.update({
              where: { id: session.id },
              data: {
                recordingEgressId: event.egressInfo.egressId,
                recordingStatus: 'RECORDING',
              },
            });
          } else if (eventType === 'egress_ended' && event.egressInfo) {
            const isComplete =
              event.egressInfo.status === EgressStatus.EGRESS_COMPLETE ||
              event.egressInfo.status === 3 ||
              event.egressInfo.status === 2 ||
              event.egressInfo.status === 'EGRESS_COMPLETE';
            const status = isComplete ? 'AVAILABLE' : 'FAILED';
            const fileUrl =
              event.egressInfo.fileResults?.[0]?.location ||
              event.egressInfo.fileResults?.[0]?.filename;
            await tx.callSession.update({
              where: { id: session.id },
              data: {
                recordingStatus: status,
                recordingUrl: fileUrl ? fileUrl : session.recordingUrl,
              },
            });
          }
        }
      }

      return { received: true, processed: true, eventId, eventType };
    });

    // Safe opportunistic cleanup of expired replay rows outside the committed transaction
    if (Math.random() < 0.05) {
      pruneExpiredWebhookReplays(this.prisma).catch(() => {});
    }

    return result;
  }

  /** Start recording the given LiveKit room and optionally link it to a call session. */
  async startRecording(user: AuthUser, dto: StartRecordingDto) {
    const egressId = await this.recorder.startRoomRecording(dto.roomName);

    if (dto.callSessionId) {
      await this.prisma.callSession.updateMany({
        where: { id: dto.callSessionId, tenantId: user.tenantId },
        data: { recordingEgressId: egressId, recordingStatus: 'RECORDING' },
      });
    }

    return { egressId, roomName: dto.roomName, status: 'RECORDING' as const };
  }

  /** Stop an in-flight recording and mark the linked call session as processing. */
  async stopRecording(user: AuthUser, dto: StopRecordingDto) {
    await this.recorder.stopRecording(dto.egressId);

    if (dto.callSessionId) {
      await this.prisma.callSession.updateMany({
        where: { id: dto.callSessionId, tenantId: user.tenantId },
        data: { recordingStatus: 'PROCESSING' },
      });
    }

    return { egressId: dto.egressId, status: 'PROCESSING' as const };
  }

  /**
   * Process a single turn in the structured 10-stage Chotu AI conversation.
   * Manages progressive state transitions, objections (disputes, callbacks, agent transfers),
   * extracted financial fields, and loop prevention.
   */
  async processTurn(user: AuthUser, dto: ConversationTurnDto): Promise<ConversationTurnResult> {
    const { tenantId } = user;
    const userText = (dto.userSpeech || '').trim();
    const textLower = userText.toLowerCase();
    const currentStage = dto.currentStage || 'GREETING_AND_VERIFICATION';
    const turnCount = (dto.turnCount || 0) + 1;
    const extracted: Record<string, any> = { ...(dto.extractedData || {}) };

    // 1. Resolve Customer and Invoice details if not already loaded in extractedData
    if (dto.customerId && !extracted.customerName) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      });
      if (customer) {
        extracted.customerName = customer.name;
        extracted.customerCompany = customer.company || '';
        extracted.outstandingAmount = `₹${Number(customer.outstandingBalance).toLocaleString('en-IN')}`;
      } else {
        extracted.customerName = 'Valued Client';
      }
    }

    if (dto.customerId && !extracted.invoiceNumber) {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          customerId: dto.customerId,
          tenantId,
          status: { in: ['OVERDUE', 'OPEN', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
      });
      if (invoice) {
        extracted.invoiceNumber = invoice.number;
        extracted.invoiceOutstanding = `₹${Number(invoice.outstanding).toLocaleString('en-IN')}`;
        extracted.invoiceDueDate = invoice.dueDate.toISOString().slice(0, 10);
      }
    }

    const customerName = extracted.customerName || 'Valued Client';
    const outstanding = extracted.invoiceOutstanding || extracted.outstandingAmount || 'your pending invoice balance';
    const invNumber = extracted.invoiceNumber || 'INV-CURRENT';

    // Context Memory: Initialize history array if not present
    if (!extracted.history) {
      extracted.history = [];
    }
    extracted.history.push({ role: 'customer', text: userText, timestamp: new Date().toISOString() });
    extracted.turnCount = turnCount;

    // Structured multi-turn state defaults
    extracted.canPay = extracted.canPay || 'UNKNOWN';
    extracted.willingToPay = extracted.willingToPay || 'UNKNOWN';
    extracted.commitmentStatus = extracted.commitmentStatus || 'NONE';

    // Safety Limit: Prevent runaway unbounded voice sessions while supporting extensive 12+ turn conversations
    const MAX_CONVERSATION_TURNS = 30;
    if (turnCount > MAX_CONVERSATION_TURNS) {
      const result: ConversationTurnResult = {
        reply: `Thank you for your time, ${customerName}. Our session has reached the maximum duration limit. Our finance desk has logged all notes and will follow up with you. Have a great day ahead!`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: extracted.commitmentStatus === 'CONFIRMED' ? 'PROMISE_TO_PAY' : (extracted.canPay === 'NO' ? 'UNABLE_TO_PAY' : 'OTHER'),
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 1. Rejection / Cancellation of Proposal or Past Agreement ─────────────
    const isRejection = this.matchesAny(textLower, [
      'no', 'wait', 'change that', 'cancel', 'wrong', 'cannot', "can't",
      'not yet', 'hold on', "don't agree", 'not agreeing', "i didn't say",
      'i never said', 'cancel that', "no i can't", 'no i cannot', 'not possible',
      'let me check', 'let me talk', 'have to discuss'
    ]);

    if (currentStage === 'SUMMARIZE_COMMITMENT' || extracted.awaitingConfirmation) {
      if (isRejection) {
        extracted.awaitingConfirmation = false;
        extracted.commitmentStatus = 'REJECTED';
        extracted.agreedAmount = null;
        extracted.promisedDate = null;

        // Check if customer expressed hardship as part of rejection
        if (this.matchesAny(textLower, ['no money', 'no funds', 'cash crunch', 'crisis', 'cannot afford', 'loss'])) {
          extracted.canPay = 'NO';
          extracted.hardshipReason = userText;
          const result: ConversationTurnResult = {
            reply: `Understood, ${customerName}. I have cancelled that proposal and noted your cash flow difficulties. Would you prefer a callback at a later date when your cash flow stabilizes, or would you like to speak to an account manager regarding flexible terms?`,
            nextStage: 'NEGOTIATE_AMOUNT',
            shouldEnd: false,
            outcome: 'UNABLE_TO_PAY',
            extractedData: extracted,
            actionExecuted: 'UNABLE_TO_PAY',
          };
          extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
          await this.persistSessionState(dto.sessionId, result);
          return result;
        }

        const result: ConversationTurnResult = {
          reply: `Understood, ${customerName}. I have cancelled that proposal. What arrangement or timeline would realistically work for your team?`,
          nextStage: 'ASK_PAYMENT_DATE',
          shouldEnd: false,
          outcome: 'IN_PROGRESS',
          extractedData: extracted,
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }
    }

    // Customer withdraws an earlier confirmed commitment
    if (extracted.commitmentStatus === 'CONFIRMED' && isRejection) {
      extracted.commitmentStatus = 'CANCELLED';
      extracted.agreedAmount = null;
      extracted.promisedDate = null;
      const result: ConversationTurnResult = {
        reply: `Understood, ${customerName}. I have noted the withdrawal of that payment schedule. Let's revisit this when your schedule clears up. Would you like a callback next month?`,
        nextStage: 'ASK_PAYMENT_DATE',
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 2. Cease-Contact / Strict DND Handling ─────────────────────────────────
    const ceaseContactPhrases = [
      'stop calling',
      'do not call',
      "don't call",
      'dont call',
      'cease contact',
      'cease all contact',
      'never call',
      'remove my number',
      'remove this number',
      'take me off your list',
      'take me off the list',
      'put me on do not call',
      'put me on the do not call',
      'stop contacting',
      'do not contact',
      'dont contact',
      'never contact',
    ];

    const isDndDemand = this.matchesAny(textLower, ceaseContactPhrases) ||
      (this.matchesAny(textLower, ['refuse to pay', "won't pay", 'not going to pay']) && this.matchesAny(textLower, ['call', 'contact', 'list']));

    if (isDndDemand) {
      let preferencePersisted = false;
      if (dto.customerId) {
        try {
          const customer = await this.prisma.customer.findFirst({
            where: { id: dto.customerId, tenantId },
          });
          if (customer) {
            const timestamp = new Date().toISOString();
            const dndTag = `[DND:NO_CONTACT - Requested on ${timestamp}]`;
            const updatedNotes = customer.notes ? `${dndTag}\n${customer.notes}` : dndTag;
            await this.prisma.customer.update({
              where: { id: customer.id },
              data: { notes: updatedNotes },
            });
            preferencePersisted = true;
          }
        } catch {
          // If persistence fails, preferencePersisted remains false
        }
      }

      const reply = preferencePersisted
        ? `Understood, ${customerName}. We have recorded your request to cease all phone calls and have updated our records accordingly. No further calls will be placed to this number. Thank you.`
        : `Understood, ${customerName}. I have noted your request to stop calls and ended this conversation. A member of our compliance team will review your contact preferences. Thank you.`;

      const result: ConversationTurnResult = {
        reply,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: 'NO_CONTACT',
        extractedData: extracted,
        actionExecuted: preferencePersisted ? 'CEASE_CONTACT_RECORDED' : undefined,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 3. Human Escalation Request ───────────────────────────────────────────
    if (this.matchesAny(textLower, ['human', 'manager', 'speak to agent', 'talk to person', 'real person', 'supervisor', 'representative', 'officer'])) {
      extracted.humanRequested = true;
      const result: ConversationTurnResult = {
        reply: `Certainly, ${customerName}. I am immediately transferring your call to a senior accounts manager. Please hold on for just a moment.`,
        nextStage: 'TRANSFERRED_TO_AGENT',
        shouldEnd: true,
        outcome: 'TRANSFERRED_TO_AGENT',
        extractedData: extracted,
        actionExecuted: 'TRANSFERRED_TO_HUMAN_AGENT',
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 3b. Customer Mind-Change on Callback Request ──────────────────────────
    if (
      currentStage === 'CALLBACK_SCHEDULED' &&
      this.matchesAny(textLower, [
        'talk now',
        'can talk',
        'can speak',
        'free now',
        'go ahead',
        'continue',
        'proceed',
        'actually i can',
        'actually, i can',
      ])
    ) {
      extracted.callbackRequested = false;
      extracted.callbackTime = null;
      const result: ConversationTurnResult = {
        reply: `Thank you, ${customerName}. Let's proceed regarding invoice #${invNumber} of ${outstanding}. Are you in a position to settle this balance or discuss a payment plan?`,
        nextStage: 'CONFIRM_BALANCE',
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        actionExecuted: 'CALLBACK_CANCELLED',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 4. Temporary Callback / Busy Objection ───────────────────────────────
    if (this.matchesAny(textLower, ['call back', 'call me back', 'call later', 'call me later', 'busy right now', 'busy', 'driving', 'in a meeting', 'meeting', 'not free', "can't talk", 'cannot talk'])) {
      const cbTime = this.extractCallbackTimeOrNull(userText);
      if (cbTime) {
        extracted.callbackRequested = true;
        extracted.callbackTime = cbTime;
        const result: ConversationTurnResult = {
          reply: `Understood, ${customerName}. I have scheduled a callback for ${cbTime}. Thank you for your time, and have a good day!`,
          nextStage: 'CALLBACK_SCHEDULED',
          shouldEnd: true,
          outcome: 'CALLBACK_REQUESTED',
          extractedData: extracted,
          actionExecuted: 'CALLBACK_SCHEDULED',
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      } else {
        extracted.callbackRequested = true;
        extracted.callbackTime = null;
        const result: ConversationTurnResult = {
          reply: `Understood, ${customerName}. When would be a convenient time for us to call you back?`,
          nextStage: 'CALLBACK_SCHEDULED',
          shouldEnd: false,
          outcome: 'CALLBACK_REQUESTED',
          extractedData: extracted,
          actionExecuted: 'CALLBACK_REQUESTED',
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }
    }

    // ── 5. Payment Claims (Already Paid / Cleared) ────────────────────────────
    const hasPaymentClaim =
      this.matchesAny(textLower, [
        'already paid', 'paid yesterday', 'payment made', 'payment done',
        'already cleared', 'paid via', 'transferred on', 'sent the money',
        'payment was already made', 'payment already made', 'payment already done'
      ]) ||
      (textLower.includes('paid') && this.matchesAny(textLower, ['neft', 'upi', 'imps', 'cheque', 'utr', 'yesterday', 'monday', 'last week'])) ||
      (textLower.includes('payment') && this.matchesAny(textLower, ['made', 'done', 'transferred', 'cleared', 'sent', 'utr'])) ||
      textLower.includes('utr') ||
      Boolean(this.extractUtrOrNull(userText)) ||
      (Boolean(extracted.paymentClaimed) && (textLower.includes('reference') || textLower.includes('txn') || textLower.includes('transaction')));

    if (hasPaymentClaim) {
      extracted.paymentClaimed = true;
      extracted.claimedAmount = this.extractAmountOrNull(userText) || outstanding;
      extracted.claimedDate = this.extractDateOrNull(userText) || 'Recent date';
      const utr = this.extractUtrOrNull(userText);
      extracted.claimedUtrOrRef = utr || 'Pending verification';

      if (utr) {
        const result: ConversationTurnResult = {
          reply: `Thank you for informing us and providing transaction UTR ${utr}, ${customerName}. I have logged your payment claim for invoice #${invNumber} with our banking desk for priority reconciliation. Your account statement will be refreshed as soon as verified.`,
          nextStage: 'CALL_ENDED',
          shouldEnd: true,
          outcome: 'PAYMENT_CLAIMED',
          extractedData: extracted,
          actionExecuted: 'PAYMENT_CLAIM_LOGGED',
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      } else {
        const result: ConversationTurnResult = {
          reply: `Thank you for informing us, ${customerName}. Could you share the transaction UTR or bank payment reference number so our billing desk can verify it?`,
          nextStage: currentStage,
          shouldEnd: false,
          outcome: 'PAYMENT_CLAIMED',
          extractedData: extracted,
          actionExecuted: 'PAYMENT_CLAIM_LOGGED',
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }
    }

    // ── 6. Invoice Disputes ───────────────────────────────────────────────────
    if (this.matchesAny(textLower, ['dispute', 'wrong amount', 'not my bill', 'fraud', 'defective', 'never received', 'incorrect amount', 'charged double', 'damaged goods', 'not our bill', 'never ordered'])) {
      extracted.isDispute = true;
      extracted.disputeReason = userText;
      const result: ConversationTurnResult = {
        reply: `I understand your concern regarding invoice #${invNumber}, ${customerName}. I have officially flagged this invoice with High Priority for account reconciliation. Our billing department will verify the records and reach out to you directly.`,
        nextStage: 'DISPUTE_LOGGED',
        shouldEnd: true,
        outcome: 'DISPUTE',
        extractedData: extracted,
        actionExecuted: 'DISPUTE_LOGGED',
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 6b. Document Delivery: Cancellation Request ───────────────────────────
    const isCancelDocRequest =
      this.matchesAny(textLower, [
        'cancel document request',
        'cancel the document request',
        'cancel document delivery',
        'cancel invoice request',
        'cancel the invoice request',
        'cancel link request',
        'cancel the link request',
        'cancel sending',
        'dont send the invoice',
        "don't send the invoice",
        'do not send the invoice',
        'dont send invoice',
        "don't send invoice",
        'dont send the payment link',
        "don't send the payment link",
        'do not send the payment link',
        'dont send the link',
        "don't send the link",
        'do not send the link',
        'dont send anything',
        "don't send anything",
        'do not send anything',
        'dont send it',
        "don't send it",
        'do not send it',
        'never mind dont send',
        "never mind don't send",
        'never mind, dont send',
        "never mind, don't send",
        'cancel that request',
      ]) ||
      (extracted.awaitingInvoiceSelection &&
        this.matchesAny(textLower, ['cancel', 'never mind', 'dont send', "don't send", 'no need', 'leave it', 'forget it']));

    if (isCancelDocRequest) {
      if (extracted.lastDocumentDeliveryId && this.documentDeliveryService) {
        try {
          await this.documentDeliveryService.cancelDelivery(user, extracted.lastDocumentDeliveryId);
        } catch {
          // Ignore if already cancelled or not found
        }
      }
      extracted.awaitingInvoiceSelection = false;
      extracted.pendingDocumentRequest = null;
      extracted.documentDelivery = {
        requestType: extracted.pendingDocumentRequest?.requestType || DocumentRequestType.INVOICE,
        invoiceNumber: invNumber,
        deliveryChannel: extracted.deliveryChannelPreference || DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
        status: 'CANCELLED',
        attempts: [],
      };

      const reply = `Understood, ${customerName}. I have cancelled the document delivery request. No documents will be sent. How else may I assist you today?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: extracted.commitmentStatus === 'CONFIRMED' ? 'PROMISE_TO_PAY' : 'IN_PROGRESS',
        extractedData: extracted,
        actionExecuted: 'DOCUMENT_DELIVERY_CANCELLED',
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 6c. Document Delivery: Awaiting Invoice Selection Resolution ──────────
    if (extracted.awaitingInvoiceSelection && extracted.pendingDocumentRequest) {
      let candidateInvoices: any[] = [];
      if (this.prisma.invoice?.findMany) {
        candidateInvoices = await this.prisma.invoice.findMany({
          where: {
            tenantId,
            customerId: dto.customerId || extracted.customerId,
            status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
          },
          orderBy: { dueDate: 'asc' },
        });
      } else {
        const single = await this.prisma.invoice?.findFirst({
          where: { tenantId, customerId: dto.customerId || extracted.customerId },
        });
        if (single) candidateInvoices = [single];
      }

      let selectedInvoice: any = null;
      if (candidateInvoices.length > 0) {
        // Match by invoice number substring
        selectedInvoice = candidateInvoices.find((inv) => {
          const invNum = inv.number.toLowerCase();
          const digits = inv.number.replace(/[^0-9]/g, '');
          const suffix = inv.number.includes('-') ? (inv.number.split('-').pop()?.toLowerCase() || '') : '';
          return (
            textLower.includes(invNum) ||
            (digits.length > 0 && textLower.includes(digits)) ||
            (suffix.length > 1 && textLower.includes(suffix))
          );
        });

        // Match by ordinal
        if (!selectedInvoice) {
          if (this.matchesAny(textLower, ['first', '1st', 'first one', 'earlier'])) {
            selectedInvoice = candidateInvoices[0];
          } else if (this.matchesAny(textLower, ['second', '2nd', 'second one', 'later']) && candidateInvoices.length > 1) {
            selectedInvoice = candidateInvoices[1];
          } else if (this.matchesAny(textLower, ['third', '3rd', 'third one']) && candidateInvoices.length > 2) {
            selectedInvoice = candidateInvoices[2];
          }
        }

        // Match by amount
        if (!selectedInvoice) {
          const numMatch = textLower.match(/\b([0-9]{3,7})\b/);
          if (numMatch) {
            const val = parseInt(numMatch[1], 10);
            selectedInvoice = candidateInvoices.find(
              (inv) => Number(inv.outstanding) === val || Number(inv.amount) === val,
            );
          }
        }
      }

      if (selectedInvoice) {
        extracted.awaitingInvoiceSelection = false;
        const pending = extracted.pendingDocumentRequest;
        extracted.pendingDocumentRequest = null;
        return this.executeDocumentDelivery(
          user,
          dto,
          extracted,
          selectedInvoice,
          pending.requestType,
          pending.deliveryChannel,
          currentStage,
          customerName,
        );
      } else {
        const invList = candidateInvoices
          .map((inv) => `#${inv.number} for ₹${Number(inv.outstanding).toLocaleString('en-IN')}`)
          .join(' and ');
        const reply = `I could not identify which invoice you selected. Please specify whether you would like ${invList}.`;
        const result: ConversationTurnResult = {
          reply,
          nextStage: currentStage,
          shouldEnd: false,
          outcome: 'IN_PROGRESS',
          extractedData: extracted,
        };
        extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }
    }

    // ── 6d. Document Delivery: Intent Detection & Dispatch ────────────────────
    const isSendBoth =
      this.matchesAny(textLower, [
        'send both',
        'send me both',
        'share both',
        'both invoice and link',
        'both invoice and payment link',
        'invoice and link',
        'invoice and payment link',
        'send invoice and payment link',
        'send invoice and link',
        'send me the invoice and link',
        'send me the invoice and payment link',
        'send the invoice and payment link',
      ]);

    const isSendLink =
      !isSendBoth &&
      this.matchesAny(textLower, [
        'send payment link',
        'send me the payment link',
        'send the payment link',
        'share payment link',
        'share the payment link',
        'send the link',
        'send me the link',
        'share the link',
        'text me the link',
        'text me the payment link',
        'whatsapp me the payment link',
        'email me the payment link',
        'payment link please',
        'pay link',
        'dispatch payment link',
        'dispatch the payment link',
      ]);

    const isSendInvoice =
      !isSendBoth &&
      !isSendLink &&
      (this.matchesAny(textLower, [
        'send invoice',
        'send me the invoice',
        'send the invoice',
        'share invoice',
        'share the invoice',
        'email me the invoice',
        'whatsapp me the invoice',
        'send copy of invoice',
        'send the bill',
        'send me the bill',
        'share the bill',
        'send statement',
        'itemized statement',
        'send my invoice',
        'forward the invoice',
        'copy of the invoice',
        'dispatch invoice',
        'dispatch the invoice',
      ]) ||
        (currentStage === 'CONFIRM_BALANCE' &&
          this.matchesAny(textLower, ['send it', "haven't received", 'share it', 'email me', 'whatsapp'])));

    const isChannelSelection =
      !isSendBoth &&
      !isSendLink &&
      !isSendInvoice &&
      this.matchesAny(textLower, [
        'only on whatsapp',
        'whatsapp only',
        'just whatsapp',
        'just on whatsapp',
        'only whatsapp',
        'email only',
        'only on email',
        'just email',
        'just on email',
        'only email',
        'both whatsapp and email',
        'both channels',
      ]);

    let explicitChannel: DeliveryChannelPreference | null = null;
    if (this.matchesAny(textLower, ['only on whatsapp', 'whatsapp only', 'just whatsapp', 'just on whatsapp', 'only whatsapp'])) {
      explicitChannel = DeliveryChannelPreference.WHATSAPP;
    } else if (this.matchesAny(textLower, ['email me the invoice', 'email me the link', 'email only', 'only on email', 'just email', 'just on email', 'only email'])) {
      explicitChannel = DeliveryChannelPreference.EMAIL;
    } else if (this.matchesAny(textLower, ['both whatsapp and email', 'whatsapp and email', 'email and whatsapp', 'both channels'])) {
      explicitChannel = DeliveryChannelPreference.WHATSAPP_AND_EMAIL;
    } else if (textLower.includes('whatsapp') && !textLower.includes('email') && (isSendInvoice || isSendLink || isSendBoth)) {
      explicitChannel = DeliveryChannelPreference.WHATSAPP;
    } else if (textLower.includes('email') && !textLower.includes('whatsapp') && (isSendInvoice || isSendLink || isSendBoth)) {
      explicitChannel = DeliveryChannelPreference.EMAIL;
    }

    if (explicitChannel) {
      extracted.deliveryChannelPreference = explicitChannel;
    }

    const effectiveChannel: DeliveryChannelPreference =
      explicitChannel ||
      extracted.deliveryChannelPreference ||
      DeliveryChannelPreference.WHATSAPP_AND_EMAIL;

    if (isChannelSelection) {
      const channelLabel =
        effectiveChannel === DeliveryChannelPreference.WHATSAPP
          ? 'WhatsApp only'
          : effectiveChannel === DeliveryChannelPreference.EMAIL
            ? 'Email only'
            : 'both WhatsApp and Email';
      const reply = `Understood, ${customerName}. I have updated your delivery channel to ${channelLabel}. Would you like me to send invoice #${invNumber} or the payment link to that channel now?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: extracted.commitmentStatus === 'CONFIRMED' ? 'PROMISE_TO_PAY' : 'IN_PROGRESS',
        extractedData: extracted,
        actionExecuted: 'DELIVERY_CHANNEL_UPDATED',
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (isSendBoth || isSendLink || isSendInvoice) {
      const requestType = isSendBoth
        ? DocumentRequestType.BOTH
        : isSendLink
          ? DocumentRequestType.PAYMENT_LINK
          : DocumentRequestType.INVOICE;

      // Check Customer's Invoices
      let customerInvoices: any[] = [];
      if (this.prisma.invoice?.findMany) {
        customerInvoices = await this.prisma.invoice.findMany({
          where: {
            tenantId,
            customerId: dto.customerId || extracted.customerId,
          },
          orderBy: { dueDate: 'asc' },
        });
      } else {
        const single = await this.prisma.invoice?.findFirst({
          where: { tenantId, customerId: dto.customerId || extracted.customerId },
        });
        if (single) customerInvoices = [single];
      }

      // Scenario 7: No valid invoice
      if (customerInvoices.length === 0) {
        const reply = `We could not locate an active invoice for ${customerName} in our records. Our billing desk has been notified to verify your account.`;
        const result: ConversationTurnResult = {
          reply,
          nextStage: currentStage,
          shouldEnd: false,
          outcome: 'IN_PROGRESS',
          extractedData: extracted,
          actionExecuted: 'DOCUMENT_DELIVERY_NO_INVOICE',
        };
        extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }

      // Check for paid / cancelled invoices if no unpaid ones
      const unpaidInvoices = customerInvoices.filter((inv) =>
        ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'].includes(inv.status),
      );

      if (unpaidInvoices.length === 0) {
        const paidInvoice = customerInvoices.find((inv) => inv.status === 'PAID');
        if (paidInvoice && requestType === DocumentRequestType.PAYMENT_LINK) {
          // Scenario 8: Already-paid invoice
          const reply = `Invoice #${paidInvoice.number} has already been paid in full. There is no outstanding balance, so no payment link is needed. Would you like me to send a paid receipt copy instead?`;
          const result: ConversationTurnResult = {
            reply,
            nextStage: currentStage,
            shouldEnd: false,
            outcome: 'IN_PROGRESS',
            extractedData: extracted,
            actionExecuted: 'DOCUMENT_DELIVERY_ALREADY_PAID',
          };
          extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
          await this.persistSessionState(dto.sessionId, result);
          return result;
        }

        const cancelledInvoice = customerInvoices.find((inv) => inv.status === 'CANCELLED');
        if (cancelledInvoice) {
          const reply = `Invoice #${cancelledInvoice.number} has been cancelled in our records. Document delivery is not available for cancelled invoices.`;
          const result: ConversationTurnResult = {
            reply,
            nextStage: currentStage,
            shouldEnd: false,
            outcome: 'IN_PROGRESS',
            extractedData: extracted,
            actionExecuted: 'DOCUMENT_DELIVERY_CANCELLED_INVOICE',
          };
          extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
          await this.persistSessionState(dto.sessionId, result);
          return result;
        }
      }

      // Scenario 6: Multiple outstanding invoices
      if (unpaidInvoices.length > 1) {
        // Check if customer explicitly specified one of the invoices in this utterance
        const matched = unpaidInvoices.find((inv) => {
          const invNum = inv.number.toLowerCase();
          const digits = inv.number.replace(/[^0-9]/g, '');
          const suffix = inv.number.includes('-') ? (inv.number.split('-').pop()?.toLowerCase() || '') : '';
          return (
            textLower.includes(invNum) ||
            (digits.length > 0 && textLower.includes(digits)) ||
            (suffix.length > 1 && textLower.includes(suffix))
          );
        });

        if (matched) {
          return this.executeDocumentDelivery(
            user,
            dto,
            extracted,
            matched,
            requestType,
            effectiveChannel,
            currentStage,
            customerName,
          );
        }

        const invList = unpaidInvoices
          .map((inv) => `#${inv.number} for ₹${Number(inv.outstanding).toLocaleString('en-IN')}`)
          .join(' and ');
        const reply = `You currently have ${unpaidInvoices.length} outstanding invoices: ${invList}. Which invoice would you like me to send?`;
        extracted.awaitingInvoiceSelection = true;
        extracted.pendingDocumentRequest = { requestType, deliveryChannel: effectiveChannel };

        const result: ConversationTurnResult = {
          reply,
          nextStage: currentStage,
          shouldEnd: false,
          outcome: 'IN_PROGRESS',
          extractedData: extracted,
          actionExecuted: 'AWAITING_INVOICE_SELECTION',
        };
        extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }

      // Single unpaid invoice (or fallback to first candidate)
      const targetInvoice = unpaidInvoices.length > 0 ? unpaidInvoices[0] : customerInvoices[0];
      return this.executeDocumentDelivery(
        user,
        dto,
        extracted,
        targetInvoice,
        requestType,
        effectiveChannel,
        currentStage,
        customerName,
      );
    }

    // ── 7. Refusals to Pay (Distinct from DND) ────────────────────────────────
    if (this.matchesAny(textLower, ['refuse to pay', 'will not pay', "won't pay", 'not going to pay', 'refusing payment', 'decline to pay', 'refuse payment', 'not paying this', 'not paying'])) {
      extracted.willingToPay = 'UNWILLING';
      extracted.refusalReason = userText;
      const result: ConversationTurnResult = {
        reply: `I understand your position, ${customerName}. We want to avoid any escalation or disruption to your commercial terms. May I ask if this refusal is due to dissatisfied service or a disagreement on invoice terms?`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: 'REFUSED_TO_PAY',
        extractedData: extracted,
        actionExecuted: 'REFUSAL_LOGGED',
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 8. Inability to Pay / Financial Hardship (Empathy First) ──────────────
    const isHardshipUtterance = this.matchesAny(textLower, [
      "can't pay anything", "cannot pay anything", "cant pay anything",
      'no money', 'cannot afford', "can't afford", 'no funds', 'bankruptcy',
      'cash crunch', 'severe loss', 'business is down', 'insolvency', 'financial crisis',
      'unable to pay right now', 'tight cash flow', 'cash flow delay', 'cash flow', 'delay this month', 'financial issue',
      'having financial issues', 'facing financial issue', 'loss in business'
    ]);

    const extractedDate = this.extractDateOrNull(userText);
    const extractedAmount = this.extractAmountOrNull(userText);
    const extractedMethod = this.extractPaymentMethodOrNull(userText);

    if (isHardshipUtterance) {
      extracted.canPay = 'NO';
      extracted.hardshipReason = userText;

      let reply = '';
      let outcome = 'UNABLE_TO_PAY';
      let nextStage: ConversationStage = 'NEGOTIATE_AMOUNT';

      if (this.matchesAny(textLower, ["can't pay anything", "cannot pay anything", "cant pay anything"])) {
        reply = `I understand, and thank you for being upfront about your financial situation, ${customerName}. We know businesses encounter unexpected cash flow challenges. Do you anticipate your financial situation easing in the coming weeks, or would you prefer a callback at a later time?`;
      } else if (textLower.includes('financial issue')) {
        if (extracted.tentativeTimeframe) {
          reply = `Understood, ${customerName}. I have noted the financial hardship on your file. When cash flow improves around ${extracted.tentativeTimeframe}, what payment method would you normally prefer — UPI, bank transfer, or a payment link?`;
          outcome = 'IN_PROGRESS';
          nextStage = 'PAYMENT_METHOD';
        } else {
          reply = `Understood, ${customerName}. I have noted the financial hardship on your file so our accounts desk is aware. Would you prefer a callback at a later date when your cash flow stabilizes, or would you like to speak to an account manager regarding flexible terms?`;
        }
      } else {
        reply = `I appreciate your honesty regarding your financial situation, ${customerName}. We recognize that businesses encounter temporary cash flow challenges. Would you be open to an installment plan, starting with a 20% token payment this week to maintain your active account status?`;
      }

      const result: ConversationTurnResult = {
        reply,
        nextStage,
        shouldEnd: false,
        outcome,
        extractedData: extracted,
        actionExecuted: outcome === 'UNABLE_TO_PAY' ? 'UNABLE_TO_PAY' : undefined,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 8b. Hardship Follow-Up: Future timeframe e.g. "20 days from now" ──────
    const isExplicitPaymentOffer =
      Boolean(extractedAmount) ||
      this.matchesAny(textLower, [
        'will pay', 'shall pay', 'confirm', 'can we pay', 'can i pay',
        'pay this', 'clearing this', 'remit', 'promising', 'transfer this',
        'releasing', 'commit to pay', 'paying on', 'definitely pay',
        'promise to pay', 'we will pay', 'i will pay', 'pay full', 'full'
      ]);

    if (extracted.canPay === 'NO' && extractedDate && !isExplicitPaymentOffer) {
      extracted.tentativeTimeframe = extractedDate;
      const result: ConversationTurnResult = {
        reply: `Thank you for sharing that timeframe, ${customerName}. So cash flow may start easing around ${extractedDate}. Could you share what primary issue caused this delay, so our finance desk can note your file?`,
        nextStage: 'ASK_DELAY_REASON',
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 8c. Future Payment Intentions ("I'll pay later", "will pay later") ────
    const isPayLater = this.matchesAny(textLower, [
      'pay later', "i'll pay later", 'i will pay later', 'will pay later', 'pay after',
      'pay afterwards', 'sometime later', 'pay next time', 'settle later', 'pay you later',
      'clear later', 'clear it later', 'pay some other time',
      'try next week', "i'll try next week", 'i will try next week', 'will try next week', 'try later', "i'll try", "i will try"
    ]);

    if (isPayLater) {
      extracted.willPayLater = true;
      const timeframe = extractedDate || (textLower.includes('next week') ? 'Next week' : null);
      if (timeframe) {
        extracted.tentativeTimeframe = timeframe;
        const result: ConversationTurnResult = {
          reply: `Thank you, ${customerName}. You mentioned paying later around ${timeframe}. Could you confirm if that will be for the full ${outstanding}, or would you prefer to break it into installments?`,
          nextStage: 'ASK_DELAY_REASON',
          shouldEnd: false,
          outcome: 'WILL_PAY_LATER',
          extractedData: extracted,
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      } else {
        const result: ConversationTurnResult = {
          reply: `Understood that you would like to pay later, ${customerName}. Could you let our accounts desk know approximately what date or timeframe you expect to clear this balance?`,
          nextStage: 'ASK_PAYMENT_DATE',
          shouldEnd: false,
          outcome: 'WILL_PAY_LATER',
          extractedData: extracted,
        };
        extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
        await this.persistSessionState(dto.sessionId, result);
        return result;
      }
    }

    // ── 9. Explicit Promise to Pay Detection (BEFORE Method-Only) ─────────────
    // Note: 'will pay later' is already intercepted above and never treated as a promise!
    const hasCommitWord = !isPayLater && currentStage !== 'NEGOTIATE_AMOUNT' && currentStage !== 'ASK_PAYMENT_DATE' && (
      this.matchesAny(textLower, [
        'shall pay', 'pay this', 'clearing this', 'remit', 'promising',
        'transfer this', 'releasing', 'commit to pay', 'paying on',
        'definitely pay', 'promise to pay'
      ]) || (textLower.includes('will pay') && !textLower.includes('later'))
    );

    if (hasCommitWord && extractedDate && !isPayLater) {
      const amt = extractedAmount || outstanding;
      const method = extractedMethod || extracted.paymentMethodPreference || 'electronic transfer';
      extracted.agreedAmount = amt;
      extracted.promisedDate = extractedDate;
      extracted.paymentMethod = method;
      extracted.canPay = 'YES';
      extracted.commitmentStatus = 'CONFIRMED';

      await this.recordPromiseInDb(user, dto, extracted);

      const result: ConversationTurnResult = {
        reply: `Thank you for confirming, ${customerName}! I have recorded your commitment to pay ${amt} by ${extractedDate} via ${method}. You will receive an acknowledgment confirmation shortly.`,
        nextStage: 'CLOSING',
        shouldEnd: true,
        outcome: 'PROMISE_TO_PAY',
        actionExecuted: 'RECORD_PAYMENT_PROMISE',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 10. Payment Method Alone e.g. "UPI" (Preference Only) ─────────────────
    if (
      extractedMethod &&
      !hasCommitWord &&
      !extractedAmount &&
      !extractedDate &&
      currentStage !== 'PAYMENT_METHOD' &&
      currentStage !== 'NEGOTIATE_AMOUNT' &&
      currentStage !== 'ASSISTANCE_CHECK' &&
      currentStage !== 'CLOSING'
    ) {
      extracted.paymentMethodPreference = extractedMethod;
      extracted.linkAuthorizationRequested = true;
      const result: ConversationTurnResult = {
        reply: `I have noted ${extractedMethod} as your preferred payment method. When you are ready to settle, would you like us to dispatch a payment link to your registered mobile, or should we wait until our follow-up call?`,
        nextStage: 'ASSISTANCE_CHECK',
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 11. Questions & Inquiries (Keeps Call in Progress) ────────────────────
    if (this.matchesAny(textLower, ['what is this for', 'which invoice', 'tell me more about this invoice', 'invoice details', 'due date', 'when was this due', 'who is this', 'what is this regarding', 'invoice number'])) {
      const dueInfo = extracted.invoiceDueDate ? ` which was due on ${extracted.invoiceDueDate}` : '';
      const result: ConversationTurnResult = {
        reply: `This is regarding invoice #${invNumber} for ${outstanding}${dueInfo}. Would you like me to dispatch the itemized PDF statement directly to your WhatsApp or registered email?`,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['how to pay', 'bank details', 'account details', 'upi id', 'where to pay', 'payment options', 'ifsc', 'account number'])) {
      const result: ConversationTurnResult = {
        reply: `You can settle securely via instant UPI, NetBanking / IMPS, or our 1-click Payment Link. Would you like me to send the payment link to your registered mobile right now?`,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['who is calling', 'who is this', 'who are you', 'whom am i speaking to', 'whom am i speaking', 'remind me who is calling'])) {
      const reply = `This is Chotu calling from myCashflo on behalf of ${customerName} accounts regarding invoice #${invNumber} for ${outstanding}. May I know if I am speaking with the finance representative?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['weather', 'temperature', 'cricket', 'football', 'movie', 'joke', 'capital of', 'prime minister', 'president'])) {
      const reply = `I do not have information on that, ${customerName}. I am calling from myCashflo on behalf of ${customerName} regarding pending invoice #${invNumber}. Can we discuss your payment status?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['hmm uh', 'hmm', 'uh', 'um', 'err', 'uhm']) && textLower.split(' ').length <= 2) {
      const reply = `I didn't quite catch that, ${customerName}. Could you please repeat or speak clearly?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage,
        shouldEnd: false,
        outcome: 'IN_PROGRESS',
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['hang up', 'bye', 'goodbye', 'disconnect'])) {
      const finalOutcome =
        extracted.commitmentStatus === 'CONFIRMED'
          ? 'PROMISE_TO_PAY'
          : extracted.callbackRequested
            ? 'CALLBACK_REQUESTED'
            : extracted.isDispute
              ? 'DISPUTE'
              : extracted.paymentClaimed
                ? 'PAYMENT_CLAIMED'
                : this.matchesAny(textLower, ['hang up', 'disconnect'])
                  ? 'NO_CONTACT'
                  : 'COMPLETED';

      const result: ConversationTurnResult = {
        reply: `Thank you for your time, ${customerName}. If you need anything further, our team is always here to assist. Have a good day.`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: finalOutcome,
        extractedData: extracted,
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // ── 12. Stage-by-Stage Progressive State Machine ──────────────────────────
    let reply = '';
    let nextStage: ConversationStage = currentStage;
    let shouldEnd = false;
    let outcome: string | undefined = undefined;
    let actionExecuted: string | undefined = undefined;

    switch (currentStage) {
      // Stage 1: GREETING_AND_VERIFICATION
      case 'GREETING_AND_VERIFICATION': {
        if (this.matchesAny(textLower, ['hello', 'hi', 'namaste', 'hey'])) {
          nextStage = 'CONFIRM_BALANCE';
          reply = `Hello! This is Chotu calling from myCashflo for ${customerName} regarding pending invoice #${invNumber} with an outstanding balance of ${outstanding}. Are you the right person to speak with regarding this account?`;
        } else if (this.matchesAny(textLower, ['yes', 'speaking', 'haan', 'this is', 'correct', 'tell me', 'go ahead'])) {
          nextStage = 'CONFIRM_BALANCE';
          reply = `Thank you for confirming, ${customerName}. This is Chotu from myCashFlo regarding invoice #${invNumber} with a pending balance of ${outstanding}. Do you have this record accessible on your end?`;
        } else if (this.matchesAny(textLower, ['no', 'wrong person', 'wrong number', 'left the company', 'not here'])) {
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          outcome = 'WRONG_CONTACT';
          reply = `My apologies for the inconvenience. I will update our records accordingly. Thank you and have a good day.`;
        } else {
          nextStage = 'CONFIRM_BALANCE';
          reply = `Thank you, ${customerName}. This is Chotu from myCashFlo regarding invoice #${invNumber} of ${outstanding}. Could you confirm if you have received our statement?`;
        }
        break;
      }

      // Stage 2: CONFIRM_BALANCE
      case 'CONFIRM_BALANCE': {
        if (this.matchesAny(textLower, ['yes', 'i have it', 'got it', 'received', 'haan', 'we have', 'know about it'])) {
          nextStage = 'ASK_FULL_PAYMENT';
          reply = `Great! Are you in a position to clear the full balance of ${outstanding} today via instant payment link or bank transfer?`;
        } else if (this.matchesAny(textLower, ['send it', "haven't received", 'share it', 'email me', 'whatsapp'])) {
          nextStage = 'ASK_FULL_PAYMENT';
          extracted.resendRequested = true;
          reply = `I will have a copy sent to your registered email and phone right away. Meanwhile, can we arrange for the payment of ${outstanding} today?`;
        } else {
          nextStage = 'ASK_FULL_PAYMENT';
          reply = `Understood. Can we arrange for the settlement of ${outstanding} today?`;
        }
        break;
      }

      // Stage 3: ASK_FULL_PAYMENT
      case 'ASK_FULL_PAYMENT': {
        if (isPayLater) {
          extracted.willPayLater = true;
          nextStage = 'ASK_PAYMENT_DATE';
          outcome = 'WILL_PAY_LATER';
          reply = `Understood that you'd like to pay later, ${customerName}. What specific date or timeframe would work for your accounts team?`;
          break;
        }
        const isNegative = this.matchesAny(textLower, ['no', 'cannot', "can't", 'not able', 'not full', 'unable', 'hard', 'difficult', 'partial', 'not possible', 'later']);
        if (!isNegative && this.matchesAny(textLower, ['yes', 'sure', 'will pay', 'doing it', 'clearing', 'full', 'okay', 'haan'])) {
          extracted.agreedAmount = outstanding;
          nextStage = 'PAYMENT_METHOD';
          reply = `Excellent! Which payment method do you prefer — UPI, NetBanking / IMPS, or a direct Payment Link?`;
        } else {
          nextStage = 'NEGOTIATE_AMOUNT';
          reply = `I understand cash flow constraints. What partial amount would you be able to clear today to keep your account active and in good standing?`;
        }
        break;
      }

      // Stage 4: NEGOTIATE_AMOUNT
      case 'NEGOTIATE_AMOUNT': {
        const parsedAmt = this.extractAmountOrNull(userText);
        const parsedDate = this.extractDateOrNull(userText);
        if (parsedAmt && parsedDate) {
          extracted.canPay = 'YES';
          extracted.agreedAmount = parsedAmt;
          extracted.promisedDate = parsedDate;
          if (extractedMethod) {
            extracted.paymentMethod = extractedMethod;
          }
          nextStage = 'SUMMARIZE_COMMITMENT';
          shouldEnd = false;
          reply = `Thank you, ${customerName}. You can pay ${parsedAmt} by ${parsedDate}. Can we confirm this commitment today?`;
        } else if (parsedAmt) {
          extracted.canPay = 'YES';
          extracted.agreedAmount = parsedAmt;
          nextStage = 'ASK_PAYMENT_DATE';
          reply = `Thank you, that helps. For the remaining balance, by what specific date can our accounts team expect the final remittance?`;
        } else if (extracted.canPay === 'NO') {
          nextStage = 'ASK_PAYMENT_DATE';
          reply = `Understood. Could you let us know approximately when your cash flow might allow a partial payment?`;
        } else {
          nextStage = 'ASK_PAYMENT_DATE';
          reply = `Thank you. By what date can our accounts team expect a payment toward this balance?`;
        }
        break;
      }

      // Stage 5: ASK_PAYMENT_DATE
      case 'ASK_PAYMENT_DATE': {
        const parsedDate = this.extractDateOrNull(userText);
        const parsedAmt = this.extractAmountOrNull(userText);
        if (parsedAmt) {
          extracted.canPay = 'YES';
          extracted.agreedAmount = parsedAmt;
        }
        if (parsedDate) {
          if (parsedAmt || extracted.canPay !== 'NO' || this.matchesAny(textLower, ['will pay', 'shall pay', 'remit', 'pay full', 'full'])) {
            extracted.canPay = 'YES';
            extracted.promisedDate = parsedDate;
            if (!extracted.agreedAmount) {
              extracted.agreedAmount = outstanding;
            }
            nextStage = 'PAYMENT_METHOD';
            reply = `Thank you, ${customerName}. I have noted payment of ${extracted.agreedAmount} on ${parsedDate}. Which payment method do you prefer — UPI, NetBanking / NEFT, or a direct Payment Link?`;
          } else {
            extracted.tentativeTimeframe = parsedDate;
            nextStage = 'ASK_DELAY_REASON';
            reply = `Noted: ${parsedDate}. Just so our finance desk can appropriately document the file, could you share the primary reason for the delay?`;
          }
        } else {
          nextStage = 'ASK_DELAY_REASON';
          reply = `Thank you. Could you share what caused this delay, so our finance desk can note your file?`;
        }
        break;
      }

      // Stage 6: ASK_DELAY_REASON
      case 'ASK_DELAY_REASON': {
        extracted.delayReason = userText;
        nextStage = 'PAYMENT_METHOD';
        reply = `Thank you for sharing that context. What is your preferred payment channel — UPI, NetBanking / NEFT, or should I dispatch a one-click payment link?`;
        break;
      }

      // Stage 7: PAYMENT_METHOD
      case 'PAYMENT_METHOD': {
        const method = this.extractPaymentMethodOrNull(userText) || 'ONLINE';
        extracted.paymentMethod = method;
        nextStage = 'ASSISTANCE_CHECK';
        reply = `Got it, ${method}. Would you like me to send an instant payment link and invoice breakdown directly to your WhatsApp and email right now?`;
        break;
      }

      // Stage 8: ASSISTANCE_CHECK
      case 'ASSISTANCE_CHECK': {
        if (this.matchesAny(textLower, ['yes', 'send', 'please', 'whatsapp', 'email', 'sure', 'okay'])) {
          extracted.sendLink = true;
        } else {
          extracted.sendLink = false;
        }

        // Only formulate a commitment summary if customer has not stated inability to pay
        if (extracted.canPay === 'NO' && !extracted.agreedAmount) {
          nextStage = 'CLOSING';
          shouldEnd = false;
          outcome = 'UNABLE_TO_PAY';
          reply = `Thank you for discussing your situation with us, ${customerName}. We have noted your hardship and tentative timeframe in our system. A relationship manager will be in touch. Is there anything else I can help you with today?`;
        } else if (extracted.willPayLater && !extracted.agreedAmount && !extracted.promisedDate) {
          nextStage = 'CLOSING';
          shouldEnd = false;
          outcome = 'WILL_PAY_LATER';
          reply = `Thank you, ${customerName}. We have noted that you intend to settle at a later date. Our team will follow up accordingly. Is there any other detail you need regarding this invoice?`;
        } else {
          const amtStr = extracted.agreedAmount || outstanding;
          const dateStr = extracted.promisedDate || 'the agreed date';
          const methodStr = extracted.paymentMethod || extracted.paymentMethodPreference || 'electronic transfer';
          extracted.paymentMethod = methodStr;
          nextStage = 'SUMMARIZE_COMMITMENT';
          reply = `Perfect. To confirm the agreement: you will remit ${amtStr} by ${dateStr} via ${methodStr}. Do you confirm this commitment?`;
        }
        break;
      }

      // Stage 9: SUMMARIZE_COMMITMENT
      case 'SUMMARIZE_COMMITMENT': {
        if (this.matchesAny(textLower, ['yes', 'confirm', 'correct', 'agreed', 'haan', 'done', 'sure', 'ok', 'okay', 'i agree', 'please confirm that'])) {
          // Strictly reject recording if customer has stated hardship/inability without an agreed amount
          if (extracted.canPay === 'NO' && !extracted.agreedAmount) {
            nextStage = 'CLOSING';
            shouldEnd = false;
            outcome = 'UNABLE_TO_PAY';
            reply = `Thank you, ${customerName}. We have noted your notes on file. Our team will follow up accordingly. Is there anything else I can assist you with?`;
          } else if (!extracted.promisedDate && !extracted.agreedAmount) {
            nextStage = 'ASK_PAYMENT_DATE';
            reply = `Before locking this in, ${customerName}, could you specify the exact date by which you will make this payment?`;
          } else {
            extracted.canPay = 'YES';
            nextStage = 'CLOSING';
            shouldEnd = false;
            outcome = 'PROMISE_TO_PAY';
            actionExecuted = 'RECORD_PAYMENT_PROMISE';
            extracted.commitmentStatus = 'CONFIRMED';
            await this.recordPromiseInDb(user, dto, extracted);
            reply = `Thank you very much, ${customerName}! Your payment commitment has been formally locked in our system. You will receive an instant confirmation acknowledgment. Is there anything else you need assistance with today?`;
          }
        } else {
          extracted.commitmentStatus = 'REJECTED';
          extracted.agreedAmount = null;
          extracted.promisedDate = null;
          nextStage = 'ASK_PAYMENT_DATE';
          reply = `No problem at all, let's adjust that. What date or amount works better for your accounts team?`;
        }
        break;
      }

      // Stage: CALLBACK_SCHEDULED
      case 'CALLBACK_SCHEDULED': {
        const extractedTime = this.extractCallbackTimeOrNull(userText) || this.extractDateOrNull(userText);
        if (extractedTime) {
          extracted.callbackRequested = true;
          extracted.callbackTime = extractedTime;
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          outcome = 'CALLBACK_REQUESTED';
          actionExecuted = 'CALLBACK_NOTED';
          reply = `Understood, ${customerName}. I have scheduled a callback for ${extractedTime}. Thank you for your time, and have a good day!`;
        } else if (this.matchesAny(textLower, ['no', 'bye', 'thank', 'thanks', 'done', 'okay', 'ok', 'later', 'disconnect', "that's all", 'thats all'])) {
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          outcome = 'CALLBACK_REQUESTED';
          actionExecuted = 'CALLBACK_NOTED';
          reply = `Understood, ${customerName}. We have noted your callback request and our team will follow up with you. Thank you and have a good day!`;
        } else {
          reply = `I have noted that you need a callback, ${customerName}. What time or day would be most suitable for you?`;
          nextStage = 'CALLBACK_SCHEDULED';
          shouldEnd = false;
          outcome = 'CALLBACK_REQUESTED';
        }
        break;
      }

      // Stage 10: CLOSING
      case 'CLOSING':
      default: {
        const isFarewell = this.matchesAny(textLower, [
          'bye', 'goodbye', 'thank you', 'thanks', 'no that is all', "that's all",
          'nothing else', 'all set', 'all good', 'done', 'have a good day', 'disconnect',
          'no thanks', 'no thank you', 'nothing more', 'we are good', 'thats it', 'no further',
          'okay thanks', 'ok thanks'
        ]);

        if (isFarewell) {
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          reply = `Thank you for your time and cooperation, ${customerName}. Have a wonderful day ahead!`;
        } else if (this.matchesAny(textLower, ['balance', 'how much', 'total', 'amount', 'outstanding'])) {
          nextStage = 'CLOSING';
          shouldEnd = false;
          reply = `Your current outstanding balance on invoice #${invNumber} is ${outstanding}. Would you like me to dispatch the itemized statement?`;
        } else if (this.matchesAny(textLower, ['receipt', 'proof', 'acknowledgment', 'confirmation'])) {
          nextStage = 'CLOSING';
          shouldEnd = false;
          reply = `Yes, an automated GST tax receipt and payment acknowledgment will be sent immediately once your payment reflects in our account.`;
        } else if (this.matchesAny(textLower, ['upi', 'ifsc', 'account', 'bank details', 'pay link', 'link', 'where to pay'])) {
          nextStage = 'CLOSING';
          shouldEnd = false;
          reply = `You can pay via instant UPI or NetBanking using our secure payment link. Would you like me to dispatch the link to your phone now?`;
        } else if (this.matchesAny(textLower, ['change', 'adjust', 'different date', 'different amount', 'renegotiate', 'modify'])) {
          nextStage = 'NEGOTIATE_AMOUNT';
          shouldEnd = false;
          reply = `Of course, ${customerName}. What amount or date adjustment would you prefer?`;
        } else {
          // General closing inquiry or discussion
          nextStage = 'CLOSING';
          shouldEnd = false;
          reply = `I have noted that for your account file, ${customerName}. If there is anything else you need regarding invoice #${invNumber}, feel free to ask, or have a wonderful day ahead!`;
        }

        if (!outcome || outcome === 'IN_PROGRESS') {
          if (extracted.canPay === 'NO') {
            outcome = 'UNABLE_TO_PAY';
          } else if (extracted.willPayLater) {
            outcome = 'WILL_PAY_LATER';
          } else if (extracted.callbackRequested) {
            outcome = 'CALLBACK_REQUESTED';
          } else if (extracted.isDispute) {
            outcome = 'DISPUTE';
          } else if (extracted.paymentClaimed) {
            outcome = 'PAYMENT_CLAIMED';
          } else if (extracted.commitmentStatus === 'CONFIRMED' && extracted.agreedAmount && extracted.promisedDate) {
            outcome = 'PROMISE_TO_PAY';
          } else {
            outcome = 'OTHER';
          }
        }
        break;
      }
    }

    if (reply) {
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
    }

    const result: ConversationTurnResult = {
      reply,
      nextStage,
      shouldEnd,
      outcome,
      extractedData: extracted,
      actionExecuted,
    };

    await this.persistSessionState(dto.sessionId, result);
    return result;
  }

  /**
   * Helper: Match any keyword in text
   */
  private matchesAny(text: string, phrases: string[]): boolean {
    return phrases.some((p) => text.includes(p));
  }

  /**
   * Helper: Extract verified currency amount string from speech.
   * Never falls back to speech text slicing!
   */
  private extractAmountOrNull(speech: string): string | null {
    const lower = speech.toLowerCase();
    if (lower.includes('half') || lower.includes('50%')) {
      return '50% of outstanding';
    }

    // Explicit currency prefix
    const currMatch = speech.match(/(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)/i);
    if (currMatch) {
      return `₹${currMatch[1]}`;
    }

    // Number followed by rupees or bucks
    const rpMatch = speech.match(/\b([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(?:rupees?|bucks?)\b/i);
    if (rpMatch) {
      return `₹${rpMatch[1]}`;
    }

    // Rejection: if the utterance is solely a timeframe (e.g. '20 days', 'in 3 weeks') -> null
    if (/^(?:in\s*)?[0-9]+\s*(?:days?|weeks?|months?|hours?|hrs?)$/i.test(lower.trim())) {
      return null;
    }

    // Rejection: if number is an invoice identifier -> null
    if (/(?:invoice|inv|bill)\s*(?:#|no\.?|num\.?)?\s*[0-9]+/i.test(lower)) {
      return null;
    }

    // Standalone numbers without timeframe or invoice words
    const numMatch = speech.match(/\b([0-9]{3,7})\b/);
    if (numMatch) {
      const isTimeframe = new RegExp(`\\b${numMatch[1]}\\s*(?:days?|weeks?|months?|hours?|hrs?)\\b`, 'i').test(lower);
      const isInvoiceNum = new RegExp(`(?:inv|bill|invoice)\\s*(?:#|no\\.?)?\\s*${numMatch[1]}\\b`, 'i').test(lower);
      if (!isTimeframe && !isInvoiceNum) {
        const val = parseInt(numMatch[1], 10);
        return `₹${val.toLocaleString('en-IN')}`;
      }
    }

    return null;
  }

  /**
   * Helper: Extract verified date or timeframe from speech.
   * Never falls back to speech text slicing!
   */
  private extractDateOrNull(speech: string): string | null {
    const lower = speech.toLowerCase();
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const d of days) {
      if (lower.includes(d)) {
        return d.charAt(0).toUpperCase() + d.slice(1);
      }
    }

    if (lower.includes('tomorrow')) return 'Tomorrow';
    if (lower.includes('today')) return 'Today';
    if (lower.includes('next week')) return 'Next week';
    if (lower.includes('end of month') || lower.includes('end of the month')) return 'End of the month';

    const daysFromNow = lower.match(/([0-9]+)\s+days?\s+from\s+now/);
    if (daysFromNow) {
      return `${daysFromNow[1]} days from now`;
    }

    const inDays = lower.match(/in\s+([0-9]+)\s+days?/);
    if (inDays) {
      return `${inDays[1]} days from now`;
    }

    const calMatch = lower.match(/\b([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/);
    if (calMatch) {
      return calMatch[1].charAt(0).toUpperCase() + calMatch[1].slice(1);
    }

    return null;
  }

  /**
   * Helper: Extract payment method from speech
   */
  private extractPaymentMethodOrNull(speech: string): string | null {
    const lower = speech.toLowerCase();
    if (this.matchesAny(lower, ['upi', 'gpay', 'phonepe', 'paytm'])) {
      return 'UPI';
    }
    if (this.matchesAny(lower, ['neft', 'rtgs', 'imps', 'netbanking', 'bank transfer', 'wire'])) {
      return 'NEFT / Bank Transfer';
    }
    if (this.matchesAny(lower, ['link', 'payment link', 'online link', 'card', 'sms'])) {
      return 'Payment Link';
    }
    if (this.matchesAny(lower, ['cheque', 'check'])) {
      return 'Cheque';
    }
    return null;
  }

  /**
   * Helper: Extract banking UTR / reference from speech
   */
  private extractUtrOrNull(speech: string): string | null {
    // 1. Explicit keyword followed optionally by 'number', 'is', 'no', ':', '-', etc.
    const utrMatch = speech.match(/(?:utr|ref|reference|txn|transaction(?:\s+utr)?|id)\s*(?:no\.?|number|id)?\s*(?:is|was|=)?\s*[:#-]?\s*([a-zA-Z0-9]{5,25})/i);
    if (utrMatch) {
      const val = utrMatch[1];
      if (!/^(?:number|pending|verification|transaction|reference)$/i.test(val)) {
        return val;
      }
    }
    // 2. Standalone alphanumeric banking reference code (e.g. ICICI987654321, HDFC12345678)
    const bankCodeMatch = speech.match(/\b([A-Z]{3,6}[0-9]{5,15})\b/i);
    if (bankCodeMatch) {
      return bankCodeMatch[1];
    }
    return null;
  }

  /**
   * Helper: Extract requested callback time or timeframe from speech
   */
  private extractCallbackTimeOrNull(speech: string): string | null {
    const lower = speech.toLowerCase();
    const tomorrowAtMatch = speech.match(/tomorrow\s+(?:at|around|by)?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
    if (tomorrowAtMatch) {
      const timePart = tomorrowAtMatch[1] ? ` at ${tomorrowAtMatch[1].trim()}` : '';
      return `tomorrow${timePart}`;
    }
    const timeMatch = speech.match(/(?:at|around|by)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
    if (timeMatch) return `at ${timeMatch[1].trim()}`;
    const afterMatch = speech.match(/after\s+([0-9]+\s+(?:hours?|hrs?|mins?|minutes?|days?))/i);
    if (afterMatch) return `after ${afterMatch[1].trim()}`;
    if (lower.includes('tomorrow morning')) return 'tomorrow morning';
    if (lower.includes('tomorrow afternoon') || lower.includes('tomorrow')) return 'tomorrow';
    if (lower.includes('this evening') || lower.includes('in the evening')) return 'this evening';
    if (lower.includes('later today')) return 'later today';
    return null;
  }

  /**
   * Record Promise to Pay in Prisma (Strict validation: never record if customer is in hardship/unable to pay)
   */
  private async recordPromiseInDb(user: AuthUser, dto: ConversationTurnDto, extracted: Record<string, any>) {
    if (!dto.customerId) return;
    if (extracted.canPay === 'NO') return; // Enforce: No promise if customer cannot pay!

    try {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          tenantId: user.tenantId,
          customerId: dto.customerId,
          status: { in: ['OVERDUE', 'OPEN', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
      });

      if (invoice) {
        const promisedDate = new Date();
        promisedDate.setDate(promisedDate.getDate() + 3);

        await this.prisma.paymentPromise.create({
          data: {
            tenantId: user.tenantId,
            invoiceId: invoice.id,
            promisedAmount: invoice.outstanding,
            promisedDate,
            notes: `Chotu AI Verified Commitment. Method: ${extracted.paymentMethod || 'Online'}. Reason: ${extracted.delayReason || 'Normal cycle'}.`,
            status: 'PENDING',
          },
        });
      }
    } catch (e) {
      console.warn(`[VoiceService] Could not auto-record PaymentPromise:`, e);
    }
  }

  /**
   * Persist session state into CallSession if sessionId is provided
   */
  private async persistSessionState(sessionId?: string, result?: ConversationTurnResult) {
    if (!sessionId || !result) return;
    try {
      const validOutcomes = [
        'PROMISE_TO_PAY',
        'DISPUTE',
        'NO_CONTACT',
        'CALLBACK_REQUESTED',
        'RESOLVED',
        'OTHER',
        'WILL_PAY_LATER',
        'UNABLE_TO_PAY',
        'PAYMENT_CLAIMED',
      ];
      await this.prisma.callSession.update({
        where: { id: sessionId },
        data: {
          stage: result.nextStage,
          metadata: result.extractedData,
          ...(result.outcome && validOutcomes.includes(result.outcome) ? { outcome: result.outcome as any } : {}),
        },
      });
    } catch (_) {
      // Ignore if session not found
    }
  }

  /**
   * Synthesize speech audio for Chotu AI voice prompts & replies
   */
  async synthesizeSpeech(text: string): Promise<Buffer> {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      return Buffer.from([]);
    }

    if (this.ttsCache.has(cleanText)) {
      return this.ttsCache.get(cleanText)!;
    }

    // Split text into chunks <= 150 characters on sentence / punctuation boundaries
    const sentences = cleanText.match(/[^.!?]+[.!?]+|\S+/g) || [cleanText];
    const chunks: string[] = [];
    let current = '';
    for (const s of sentences) {
      if ((current + ' ' + s).trim().length > 150) {
        if (current) chunks.push(current.trim());
        current = s;
      } else {
        current = current ? current + ' ' + s : s;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    try {
      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        if (this.ttsCache.has(chunk)) {
          buffers.push(this.ttsCache.get(chunk)!);
          continue;
        }
        const q = encodeURIComponent(chunk);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-IN&client=tw-ob&q=${q}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });
        if (!res.ok) {
          throw new Error(`TTS upstream returned status ${res.status}`);
        }
        const arrayBuf = await res.arrayBuffer();
        const chunkBuf = Buffer.from(arrayBuf);
        this.ttsCache.set(chunk, chunkBuf);
        buffers.push(chunkBuf);
      }
      const fullBuffer = Buffer.concat(buffers);
      this.ttsCache.set(cleanText, fullBuffer);
      return fullBuffer;
    } catch (err) {
      console.warn('[VoiceService] Google TTS failed, falling back to clean synthetic audio tone:', err);
      return this.generateFallbackAudio(cleanText.length);
    }
  }

  /**
   * Execute customer document or payment link delivery via DocumentDeliveryService.
   * Manages status resolution, duplicate checks, channel routing, and safe state machine transitions.
   */
  private async executeDocumentDelivery(
    user: AuthUser,
    dto: ConversationTurnDto,
    extracted: Record<string, any>,
    invoice: any,
    requestType: DocumentRequestType,
    deliveryChannel: DeliveryChannelPreference,
    currentStage: ConversationStage,
    customerName: string,
  ): Promise<ConversationTurnResult> {
    const customerId = dto.customerId || extracted.customerId || invoice.customerId;
    const invNumber = invoice.number;

    let deliveryRes: any;
    if (this.documentDeliveryService) {
      try {
        deliveryRes = await this.documentDeliveryService.requestDelivery(user, {
          customerId,
          invoiceId: invoice.id,
          callSessionId: dto.sessionId,
          requestType,
          deliveryChannel,
          requestedBy: 'CHOTU_AI_VOICE',
        });
      } catch (err: any) {
        this.logger.error(`Document delivery failed: ${err.message}`, err.stack);
        deliveryRes = {
          request: {
            id: `req_err_${Date.now()}`,
            status: DocumentDeliveryStatus.FAILED,
            requestType,
            deliveryChannel,
            attempts: [],
          },
          isDuplicate: false,
          message: err.message,
        };
      }
    } else {
      deliveryRes = {
        request: {
          id: `mock_req_${Date.now()}`,
          status: DocumentDeliveryStatus.COMPLETED,
          requestType,
          deliveryChannel,
          attempts: [
            { channel: 'WHATSAPP', destinationMasked: '+91 ****3210', status: 'SIMULATED' },
            { channel: 'EMAIL', destinationMasked: 'c****@test.com', status: 'SIMULATED' },
          ],
        },
        isDuplicate: false,
      };
    }

    // 1. Scenario 12: Duplicate request during the same call
    if (deliveryRes.isDuplicate) {
      const channelLabel =
        deliveryChannel === DeliveryChannelPreference.WHATSAPP
          ? 'WhatsApp'
          : deliveryChannel === DeliveryChannelPreference.EMAIL
            ? 'email'
            : 'WhatsApp and email';

      const reply = `We have already sent invoice #${invNumber} to your registered ${channelLabel} during this call. Would you like me to resend an additional copy?`;
      const result: ConversationTurnResult = {
        reply,
        nextStage: currentStage === 'GREETING_AND_VERIFICATION' ? 'CONFIRM_BALANCE' : currentStage,
        shouldEnd: false,
        outcome: extracted.commitmentStatus === 'CONFIRMED' ? 'PROMISE_TO_PAY' : 'IN_PROGRESS',
        extractedData: extracted,
        actionExecuted: 'DOCUMENT_DELIVERY_DUPLICATE_CHECKED',
      };
      extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    const reqStatus = deliveryRes.request?.status || DocumentDeliveryStatus.COMPLETED;
    const attempts: any[] = deliveryRes.request?.attempts || [];
    const waAttempt = attempts.find((a: any) => a.channel === 'WHATSAPP');
    const emailAttempt = attempts.find((a: any) => a.channel === 'EMAIL');
    const maskedPhone = waAttempt?.destinationMasked || '+91 ****';
    const maskedEmail = emailAttempt?.destinationMasked || 'registered email';

    extracted.lastDocumentDeliveryId = deliveryRes.request?.id;
    extracted.documentDelivery = {
      requestType: deliveryRes.request?.requestType || requestType,
      invoiceNumber: invNumber,
      deliveryChannel: deliveryRes.request?.deliveryChannel || deliveryChannel,
      status: reqStatus,
      attempts: attempts.map((a: any) => ({
        channel: a.channel,
        destinationMasked: a.destinationMasked,
        status: a.status,
        errorMessage: a.errorMessage,
      })),
    };

    let reply = '';
    // Scenario 10: WhatsApp succeeds but Email fails (Partial Success)
    if (reqStatus === DocumentDeliveryStatus.PARTIAL_SUCCESS) {
      if (waAttempt && (waAttempt.status === 'SENT' || waAttempt.status === 'SIMULATED')) {
        const docDesc =
          requestType === DocumentRequestType.BOTH
            ? `invoice #${invNumber} and payment link`
            : requestType === DocumentRequestType.PAYMENT_LINK
              ? `the payment link for invoice #${invNumber}`
              : `invoice #${invNumber}`;
        reply = `I have successfully sent ${docDesc} to your WhatsApp at ${maskedPhone}. However, the email delivery could not be completed because there is no valid email on file. Our team will verify your email address.`;
      } else {
        reply = `I have successfully sent the documents to your email at ${maskedEmail}. However, the WhatsApp delivery could not be completed. Our team will follow up with you.`;
      }
    } else if (reqStatus === DocumentDeliveryStatus.FAILED) {
      reply = `I was unable to dispatch the documents because there are no valid contact details on file for your account. Our billing desk has been notified to update your contact information.`;
    } else {
      // Full Success or Simulation (Scenarios 1, 2, 3, 4, 5, 11)
      const isSimulated = attempts.every((a: any) => a.status === 'SIMULATED');
      const simSuffix = isSimulated ? ' in simulation mode' : '';

      if (requestType === DocumentRequestType.INVOICE) {
        if (deliveryChannel === DeliveryChannelPreference.WHATSAPP) {
          reply = `I have sent the invoice PDF for invoice #${invNumber} to your WhatsApp at ${maskedPhone}${simSuffix}.`;
        } else if (deliveryChannel === DeliveryChannelPreference.EMAIL) {
          reply = `I have emailed the invoice PDF for invoice #${invNumber} to your email address at ${maskedEmail}${simSuffix}.`;
        } else {
          reply = `I have dispatched the invoice PDF for invoice #${invNumber} to your WhatsApp at ${maskedPhone} and emailed a copy to ${maskedEmail}${simSuffix}.`;
        }
      } else if (requestType === DocumentRequestType.PAYMENT_LINK) {
        if (deliveryChannel === DeliveryChannelPreference.WHATSAPP) {
          reply = `I have sent the instant payment link for invoice #${invNumber} to your WhatsApp at ${maskedPhone}${simSuffix}.`;
        } else if (deliveryChannel === DeliveryChannelPreference.EMAIL) {
          reply = `I have emailed the instant payment link for invoice #${invNumber} to ${maskedEmail}${simSuffix}.`;
        } else {
          reply = `I have dispatched the instant payment link for invoice #${invNumber} to your WhatsApp at ${maskedPhone} and your email at ${maskedEmail}${simSuffix}.`;
        }
      } else {
        if (deliveryChannel === DeliveryChannelPreference.WHATSAPP) {
          reply = `I have sent both invoice #${invNumber} and the instant payment link to your WhatsApp at ${maskedPhone}${simSuffix}.`;
        } else if (deliveryChannel === DeliveryChannelPreference.EMAIL) {
          reply = `I have emailed both invoice #${invNumber} and the instant payment link to ${maskedEmail}${simSuffix}.`;
        } else {
          reply = `I have dispatched both invoice #${invNumber} and the instant payment link to your WhatsApp at ${maskedPhone} and your email at ${maskedEmail}${simSuffix}.`;
        }
      }
    }

    if (requestType === DocumentRequestType.PAYMENT_LINK || requestType === DocumentRequestType.BOTH) {
      extracted.sendLink = true;
    }

    let nextStage: ConversationStage = currentStage;
    if (extracted.agreedAmount && extracted.promisedDate) {
      nextStage = 'SUMMARIZE_COMMITMENT';
      const methodStr = extracted.paymentMethod || extracted.paymentMethodPreference || 'electronic transfer';
      reply += ` To confirm the agreement: you will remit ${extracted.agreedAmount} by ${extracted.promisedDate} via ${methodStr}. Do you confirm this commitment?`;
    } else if (currentStage === 'GREETING_AND_VERIFICATION' || currentStage === 'CONFIRM_BALANCE') {
      nextStage = 'ASK_FULL_PAYMENT';
    } else if (currentStage === 'PAYMENT_METHOD' || currentStage === 'ASK_PAYMENT_DATE') {
      nextStage = 'ASSISTANCE_CHECK';
    }

    // Safety rule: Customer requesting payment link/invoice does NOT constitute a promise to pay!
    const outcome = extracted.commitmentStatus === 'CONFIRMED' ? 'PROMISE_TO_PAY' : 'IN_PROGRESS';

    const result: ConversationTurnResult = {
      reply,
      nextStage,
      shouldEnd: false,
      outcome,
      extractedData: extracted,
      actionExecuted: 'DOCUMENT_DELIVERY_DISPATCHED',
    };

    extracted.history.push({ role: 'agent', text: reply, timestamp: new Date().toISOString() });
    await this.persistSessionState(dto.sessionId, result);
    return result;
  }

  /**
   * Generate lightweight PCM/WAV speech-cadence carrier audio if upstream TTS is unavailable
   */
  private generateFallbackAudio(approxCharLength: number): Buffer {
    const sampleRate = 44100;
    const durationSec = Math.max(1, Math.min(10, approxCharLength * 0.065));
    const numSamples = Math.floor(sampleRate * durationSec);
    const dataSize = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32); // Block align
    buffer.writeUInt16LE(16, 34); // Bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    const freq = 220;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const mod = Math.sin(2 * Math.PI * 4 * t) * 0.3 + 0.7;
      const sample = Math.sin(2 * Math.PI * freq * t) * mod * 0.25;
      const int16 = Math.floor(sample * 32767);
      buffer.writeInt16LE(int16, 44 + i * 2);
    }

    return buffer;
  }
}


