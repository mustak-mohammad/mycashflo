import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
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

    // If real LiveKit credentials exist, sign a valid LiveKit JWT with roomJoin grants
    const isMock = !livekitApiKey || !livekitApiSecret || livekitApiKey === 'placeholder';

    let token = '';
    if (!isMock) {
      try {
        const at = new AccessToken(livekitApiKey, livekitApiSecret, {
          identity: participantIdentity,
          name: participantName,
          ttl: '1h',
        });
        at.addGrant({
          room: roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
        });
        token = await at.toJwt();
      } catch {
        token = Buffer.from(
          JSON.stringify({
            sub: participantIdentity,
            name: participantName,
            room: roomName,
            tenantId: user.tenantId,
            customerId: dto.customerId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            mode: 'mock',
          }),
        ).toString('base64url');
      }
    } else {
      token = Buffer.from(
        JSON.stringify({
          sub: participantIdentity,
          name: participantName,
          room: roomName,
          tenantId: user.tenantId,
          customerId: dto.customerId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          mode: 'mock',
        }),
      ).toString('base64url');
    }

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

    // ── 4. Temporary Callback / Busy Objection ───────────────────────────────
    if (this.matchesAny(textLower, ['call back', 'call me back', 'call later', 'call me later', 'busy right now', 'busy', 'driving', 'in a meeting', 'meeting', 'not free', "can't talk", 'cannot talk'])) {
      extracted.callbackRequested = true;
      const result: ConversationTurnResult = {
        reply: `Understood, ${customerName}. I will schedule a follow-up reminder for our team to connect at a more convenient time later today. Thank you for your time.`,
        nextStage: 'CALLBACK_SCHEDULED',
        shouldEnd: true,
        outcome: 'CALLBACK_REQUESTED',
        extractedData: extracted,
        actionExecuted: 'CALLBACK_SCHEDULED',
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
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
      (textLower.includes('utr') && this.matchesAny(textLower, ['paid', 'payment', 'made', 'transferred', 'yesterday']));

    if (hasPaymentClaim) {
      extracted.paymentClaimed = true;
      extracted.claimedAmount = this.extractAmountOrNull(userText) || outstanding;
      extracted.claimedDate = this.extractDateOrNull(userText) || 'Recent date';
      const utr = this.extractUtrOrNull(userText);
      extracted.claimedUtrOrRef = utr || 'Pending verification';

      const refNote = utr ? ` (Reference/UTR: ${utr})` : '';
      const result: ConversationTurnResult = {
        reply: `Thank you for informing us, ${customerName}. I have logged your payment claim for invoice #${invNumber}${refNote} with our banking desk for priority reconciliation. Your account statement will be refreshed as soon as verified.`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: 'PAYMENT_CLAIMED',
        extractedData: extracted,
        actionExecuted: 'PAYMENT_CLAIM_LOGGED',
      };
      extracted.history.push({ role: 'agent', text: result.reply, timestamp: new Date().toISOString() });
      await this.persistSessionState(dto.sessionId, result);
      return result;
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
      'unable to pay right now', 'tight cash flow', 'financial issue',
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
    if (extracted.canPay === 'NO' && extractedDate) {
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
      'clear later', 'clear it later', 'pay some other time'
    ]);

    if (isPayLater) {
      extracted.willPayLater = true;
      if (extractedDate) {
        extracted.tentativeTimeframe = extractedDate;
        const result: ConversationTurnResult = {
          reply: `Thank you, ${customerName}. You mentioned paying later around ${extractedDate}. Could you confirm if that will be for the full ${outstanding}, or would you prefer to break it into installments?`,
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
    const hasCommitWord = !isPayLater && (
      this.matchesAny(textLower, [
        'shall pay', 'pay this', 'clearing this', 'remit', 'promising',
        'transfer this', 'releasing', 'i can pay', 'commit to pay', 'paying on',
        'definitely pay', 'promise to pay'
      ]) || (textLower.includes('will pay') && !textLower.includes('later'))
    );

    if (hasCommitWord && extractedDate && extracted.canPay !== 'NO' && !isPayLater) {
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
    if (extractedMethod && !hasCommitWord && currentStage !== 'PAYMENT_METHOD' && currentStage !== 'ASSISTANCE_CHECK' && currentStage !== 'CLOSING') {
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

    if (this.matchesAny(textLower, ['hang up', 'bye', 'goodbye', 'disconnect'])) {
      const result: ConversationTurnResult = {
        reply: `Thank you for your time, ${customerName}. If you need anything further, our team is always here to assist. Have a good day.`,
        nextStage: 'CALL_ENDED',
        shouldEnd: true,
        outcome: 'NO_CONTACT',
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
        if (this.matchesAny(textLower, ['yes', 'speaking', 'haan', 'this is', 'correct', 'tell me', 'go ahead'])) {
          nextStage = 'CONFIRM_BALANCE';
          reply = `Thank you for confirming. I am reaching out regarding invoice #${invNumber} with a pending balance of ${outstanding}. Do you have this record accessible on your end?`;
        } else if (this.matchesAny(textLower, ['no', 'wrong person', 'wrong number', 'left the company', 'not here'])) {
          nextStage = 'CALL_ENDED';
          shouldEnd = true;
          outcome = 'WRONG_CONTACT';
          reply = `My apologies for the inconvenience. I will update our records accordingly. Thank you and have a good day.`;
        } else {
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
        if (parsedAmt) {
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
        if (parsedDate) {
          if (extracted.canPay === 'NO') {
            extracted.tentativeTimeframe = parsedDate;
          } else {
            extracted.promisedDate = parsedDate;
          }
          nextStage = 'ASK_DELAY_REASON';
          reply = `Noted: ${parsedDate}. Just so our finance desk can appropriately document the file, could you share the primary reason for the delay?`;
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
        if (extracted.canPay === 'NO') {
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
          const methodStr = extracted.paymentMethod || 'electronic transfer';
          nextStage = 'SUMMARIZE_COMMITMENT';
          reply = `Perfect. To confirm the agreement: you will remit ${amtStr} by ${dateStr} via ${methodStr}. Do you confirm this commitment?`;
        }
        break;
      }

      // Stage 9: SUMMARIZE_COMMITMENT
      case 'SUMMARIZE_COMMITMENT': {
        if (this.matchesAny(textLower, ['yes', 'confirm', 'correct', 'agreed', 'haan', 'done', 'sure', 'ok', 'okay', 'i agree'])) {
          // Strictly reject recording if customer has stated hardship/inability
          if (extracted.canPay === 'NO') {
            nextStage = 'CLOSING';
            shouldEnd = false;
            outcome = 'UNABLE_TO_PAY';
            reply = `Thank you, ${customerName}. We have noted your notes on file. Our team will follow up accordingly. Is there anything else I can assist you with?`;
          } else if (!extracted.promisedDate && !extracted.agreedAmount) {
            nextStage = 'ASK_PAYMENT_DATE';
            reply = `Before locking this in, ${customerName}, could you specify the exact date by which you will make this payment?`;
          } else {
            nextStage = 'CLOSING';
            shouldEnd = false;
            outcome = 'PROMISE_TO_PAY';
            actionExecuted = 'RECORD_PAYMENT_PROMISE';
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

    // Rejection: if number is actually a timeframe (e.g. '20 days', '3 weeks') -> null
    if (/\b[0-9]+\s*(?:days?|weeks?|months?|hours?|hrs?)\b/i.test(lower)) {
      return null;
    }

    // Rejection: if number is an invoice identifier -> null
    if (/(?:invoice|inv|bill)\s*(?:#|no\.?|num\.?)?\s*[0-9]+/i.test(lower)) {
      return null;
    }

    // Standalone numbers without timeframe or invoice words
    const numMatch = speech.match(/\b([0-9]{3,7})\b/);
    if (numMatch && !['day', 'days', 'week', 'weeks', 'month', 'months', 'inv', 'bill'].some((w) => lower.includes(w))) {
      return `₹${numMatch[1]}`;
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
    const utrMatch = speech.match(/(?:utr|ref|reference|txn|transaction|id)\s*[:#-]?\s*([a-zA-Z0-9]{5,25})/i);
    return utrMatch ? utrMatch[1] : null;
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
        buffers.push(Buffer.from(arrayBuf));
      }
      return Buffer.concat(buffers);
    } catch (err) {
      console.warn('[VoiceService] Google TTS failed, falling back to clean synthetic audio tone:', err);
      return this.generateFallbackAudio(cleanText.length);
    }
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


