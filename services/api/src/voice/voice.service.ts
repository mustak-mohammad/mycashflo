import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecorderService } from './recorder.service.js';
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
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly recorder: RecorderService,
  ) {}

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

    // 2. Global Objection Handling (Can interrupt any stage)
    if (this.matchesAny(textLower, ['human', 'manager', 'speak to agent', 'talk to person', 'real person', 'supervisor'])) {
      const result: ConversationTurnResult = {
        reply: `Certainly, ${customerName}. I am immediately transferring your call to a senior accounts manager. Please hold on for just a moment.`,
        nextStage: 'TRANSFERRED_TO_AGENT',
        shouldEnd: true,
        outcome: 'TRANSFERRED_TO_AGENT',
        extractedData: extracted,
        actionExecuted: 'TRANSFERRED_TO_HUMAN_AGENT',
      };
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['call back', 'call later', 'busy right now', 'driving', 'in a meeting', 'not free'])) {
      const result: ConversationTurnResult = {
        reply: `Understood, ${customerName}. I will schedule a follow-up reminder for our team to connect at a more convenient time later today. Thank you for your time.`,
        nextStage: 'CALLBACK_SCHEDULED',
        shouldEnd: true,
        outcome: 'CALLBACK_REQUESTED',
        extractedData: extracted,
        actionExecuted: 'CALLBACK_SCHEDULED',
      };
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['dispute', 'already paid', 'wrong amount', 'not my bill', 'fraud', 'defective', 'never received'])) {
      extracted.disputeReason = userText;
      const result: ConversationTurnResult = {
        reply: `I understand your concern regarding invoice #${invNumber}, ${customerName}. I have officially flagged this invoice with High Priority for account reconciliation. Our billing department will verify the records and reach out to you directly.`,
        nextStage: 'DISPUTE_LOGGED',
        shouldEnd: true,
        outcome: 'DISPUTE',
        extractedData: extracted,
        actionExecuted: 'DISPUTE_LOGGED',
      };
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    if (this.matchesAny(textLower, ['hang up', 'stop calling', 'bye', 'goodbye', 'disconnect'])) {
      const result: ConversationTurnResult = {
        reply: `Thank you for your time, ${customerName}. If you need anything further, our team is always here to assist. Have a good day.`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: 'NO_CONTACT',
        extractedData: extracted,
      };
      await this.persistSessionState(dto.sessionId, result);
      return result;
    }

    // 3. Stage-by-Stage Progressive State Machine
    let reply = '';
    let nextStage: ConversationStage = currentStage;
    let shouldEnd = false;
    let outcome: string | undefined = undefined;
    let actionExecuted: string | undefined = undefined;

    switch (currentStage) {
      // Stage 1: GREETING_AND_VERIFICATION
      case 'GREETING_AND_VERIFICATION': {
        if (this.matchesAny(textLower, ['yes', 'speaking', 'haan', 'this is', 'correct', 'tell me', 'go ahead'])) {
          nextStage = 'CONFIRM_BALANCE';
          reply = `Thank you for confirming. I am reaching out regarding invoice #${invNumber} with a pending balance of ${outstanding}. Do you have this record accessible on your end?`;
        } else if (this.matchesAny(textLower, ['no', 'wrong person', 'wrong number', 'left the company', 'not here'])) {
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          outcome = 'WRONG_CONTACT';
          reply = `My apologies for the inconvenience. I will update our records accordingly. Thank you and have a good day.`;
        } else {
          // Fallback or repeat greeting
          nextStage = 'CONFIRM_BALANCE';
          reply = `Thank you. I am calling from myCashflo regarding invoice #${invNumber} of ${outstanding}. Could you confirm if you have received our statement?`;
        }
        break;
      }

      // Stage 2: CONFIRM_BALANCE
      case 'CONFIRM_BALANCE': {
        if (this.matchesAny(textLower, ['yes', 'i have it', 'got it', 'received', 'haan', 'we have', 'know about it'])) {
          nextStage = 'ASK_FULL_PAYMENT';
          reply = `Great! Are you in a position to clear the full balance of ${outstanding} today via instant payment link or bank transfer?`;
        } else if (this.matchesAny(textLower, ['send it', 'haven\'t received', 'share it', 'email me', 'whatsapp'])) {
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
        const isNegative = this.matchesAny(textLower, ['no', 'cannot', "can't", 'not able', 'not full', 'unable', 'hard', 'difficult', 'partial', 'not possible']);
        if (!isNegative && this.matchesAny(textLower, ['yes', 'sure', 'will pay', 'doing it', 'clearing', 'full', 'okay', 'haan'])) {
          extracted.agreedAmount = outstanding;
          nextStage = 'PAYMENT_METHOD';
          reply = `Excellent! Which payment method do you prefer — UPI, NetBanking / IMPS, or a direct Payment Link?`;
        } else {
          // Customer cannot pay full amount today
          nextStage = 'NEGOTIATE_AMOUNT';
          reply = `I understand cash flow constraints. What partial amount would you be able to clear today to keep your account active and in good standing?`;
        }
        break;
      }

      // Stage 4: NEGOTIATE_AMOUNT
      case 'NEGOTIATE_AMOUNT': {
        // Extract partial amount or note
        extracted.agreedAmount = this.extractAmountOrFallback(userText, 'partial commitment');
        nextStage = 'ASK_PAYMENT_DATE';
        reply = `Thank you, that helps. For the remaining balance, by what specific date can our accounts team expect the final remittance?`;
        break;
      }

      // Stage 5: ASK_PAYMENT_DATE
      case 'ASK_PAYMENT_DATE': {
        extracted.promisedDate = this.extractDateOrFallback(userText);
        nextStage = 'ASK_DELAY_REASON';
        reply = `Noted: ${extracted.promisedDate}. Just so our finance desk can appropriately document the file, could you share the primary reason for the delay?`;
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
        if (this.matchesAny(textLower, ['upi', 'gpay', 'phonepe', 'paytm'])) {
          extracted.paymentMethod = 'UPI';
        } else if (this.matchesAny(textLower, ['link', 'sms', 'whatsapp', 'card'])) {
          extracted.paymentMethod = 'PAYMENT_LINK';
        } else if (this.matchesAny(textLower, ['neft', 'rtgs', 'imps', 'netbanking', 'bank transfer'])) {
          extracted.paymentMethod = 'NET_BANKING';
        } else if (this.matchesAny(textLower, ['cheque', 'check'])) {
          extracted.paymentMethod = 'CHEQUE';
        } else {
          extracted.paymentMethod = 'ONLINE';
        }

        nextStage = 'ASSISTANCE_CHECK';
        reply = `Got it, ${extracted.paymentMethod}. Would you like me to send an instant payment link and invoice breakdown directly to your WhatsApp and email right now?`;
        break;
      }

      // Stage 8: ASSISTANCE_CHECK
      case 'ASSISTANCE_CHECK': {
        if (this.matchesAny(textLower, ['yes', 'send', 'please', 'whatsapp', 'email', 'sure', 'okay'])) {
          extracted.sendLink = true;
        } else {
          extracted.sendLink = false;
        }

        const amtStr = extracted.agreedAmount || outstanding;
        const dateStr = extracted.promisedDate || 'the agreed date';
        const methodStr = extracted.paymentMethod || 'electronic transfer';

        nextStage = 'SUMMARIZE_COMMITMENT';
        reply = `Perfect. To confirm the agreement: you will remit ${amtStr} by ${dateStr} via ${methodStr}. Do you confirm this commitment?`;
        break;
      }

      // Stage 9: SUMMARIZE_COMMITMENT
      case 'SUMMARIZE_COMMITMENT': {
        if (this.matchesAny(textLower, ['yes', 'confirm', 'correct', 'agreed', 'haan', 'done', 'sure', 'ok', 'okay'])) {
          nextStage = 'CLOSING';
          shouldEnd = true;
          outcome = 'PROMISE_TO_PAY';
          actionExecuted = 'RECORD_PAYMENT_PROMISE';

          // Automatically record payment promise in database if customerId is present
          await this.recordPromiseInDb(user, dto, extracted);

          reply = `Thank you very much, ${customerName}! Your payment commitment has been formally locked in our system. You will receive an instant confirmation acknowledgment. Have a wonderful day ahead!`;
        } else {
          // If customer hesitates or wants to alter
          nextStage = 'ASK_PAYMENT_DATE';
          reply = `No problem at all, let's adjust that. What date or amount works better for your accounts team?`;
        }
        break;
      }

      // Stage 10: CLOSING
      case 'CLOSING':
      default: {
        nextStage = 'CLOSING';
        shouldEnd = true;
        outcome = 'COMPLETED';
        reply = `Thank you for your cooperation, ${customerName}. Have a great day!`;
        break;
      }
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
   * Helper: Extract amount string from speech
   */
  private extractAmountOrFallback(speech: string, fallback: string): string {
    const match = speech.match(/(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)/i);
    if (match) {
      return `₹${match[1]}`;
    }
    if (speech.toLowerCase().includes('half') || speech.toLowerCase().includes('50%')) {
      return '50% of outstanding';
    }
    return speech.slice(0, 30) || fallback;
  }

  /**
   * Helper: Extract date or timeframe from speech
   */
  private extractDateOrFallback(speech: string): string {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tomorrow', 'today', 'next week', 'end of month'];
    const lower = speech.toLowerCase();
    for (const d of days) {
      if (lower.includes(d)) {
        return d.charAt(0).toUpperCase() + d.slice(1);
      }
    }
    return speech.slice(0, 30) || 'Upcoming Friday';
  }

  /**
   * Record Promise to Pay in Prisma
   */
  private async recordPromiseInDb(user: AuthUser, dto: ConversationTurnDto, extracted: Record<string, any>) {
    if (!dto.customerId) return;
    try {
      // Find invoice
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          tenantId: user.tenantId,
          customerId: dto.customerId,
          status: { in: ['OVERDUE', 'OPEN', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
      });

      if (invoice) {
        // Calculate promise date: default 3 days from now or next Friday
        const promisedDate = new Date();
        promisedDate.setDate(promisedDate.getDate() + 3);

        await this.prisma.paymentPromise.create({
          data: {
            tenantId: user.tenantId,
            invoiceId: invoice.id,
            promisedAmount: invoice.outstanding,
            promisedDate,
            notes: `Chotu AI 10-Stage Voice Call Commitment. Method: ${extracted.paymentMethod || 'Online'}. Reason: ${extracted.delayReason || 'Normal cycle'}.`,
            status: 'PENDING',
          },
        });
      }
    } catch (e) {
      // Log warning without failing conversation
      console.warn(`[VoiceService] Could not auto-record PaymentPromise:`, e);
    }
  }

  /**
   * Persist session state into CallSession if sessionId is provided
   */
  private async persistSessionState(sessionId?: string, result?: ConversationTurnResult) {
    if (!sessionId || !result) return;
    try {
      await this.prisma.callSession.update({
        where: { id: sessionId },
        data: {
          stage: result.nextStage,
          metadata: result.extractedData,
          ...(result.outcome ? { outcome: result.outcome as any } : {}),
        },
      });
    } catch (_) {
      // Ignore if session not found
    }
  }
}

