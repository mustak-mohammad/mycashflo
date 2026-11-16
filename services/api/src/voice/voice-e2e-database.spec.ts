import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { VoiceService } from './voice.service.js';
import { CallsService } from '../calls/calls.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

describe('Chotu Voice E2E Integration with Live Database & Recording Pipeline', () => {
  let prisma: PrismaClient;
  let voiceService: VoiceService;
  let callsService: CallsService;

  const testUser: AuthUser = {
    userId: 'cmv6st54c0004cxtobgt6gn5t',
    tenantId: 'cmv6st4xn0000cxtopjci9l0h',
    role: 'AGENT',
  };

  const customerId = 'cmvj9e62q0018cxwg829pn6rv'; // ABC Tech

  beforeAll(async () => {
    prisma = new PrismaClient();
    const configService = new ConfigService({
      LIVEKIT_URL: 'wss://livekit.test.com',
      LIVEKIT_API_KEY: 'test_key',
      LIVEKIT_API_SECRET: 'test_secret_12345678901234567890',
    });

    voiceService = new VoiceService(configService as any, prisma as any);
    callsService = new CallsService(prisma as any);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Initial Prompt & Greeting Resolution', () => {
    it('generates verified collections greeting using customer name ABC Tech and balance ₹25,000, rejecting dispute prompt', async () => {
      // Intentionally pass the dispute prompt ID
      const disputePromptId = 'cmv9lusdb000ccx74jz5hkgi3';
      const result = await voiceService.getInitialGreeting(testUser, {
        callType: 'COLLECTIONS',
        customerId,
        promptId: disputePromptId,
      });

      expect(result.callType).toBe('COLLECTIONS');
      expect(result.greeting).toContain('ABC Tech');
      expect(result.greeting).toContain('₹25,000');
      // Must NOT contain system prompt instructions or dispute reconciliation lines
      expect(result.greeting.startsWith('You are Chotu, accounts reconciliation specialist')).toBe(false);
      expect(result.greeting).not.toContain('accounts reconciliation specialist');
      expect(result.greeting).not.toContain('Capture specific item discrepancies');
      expect(result.greeting).not.toContain('Rules:');
    });

    it('generates appropriate dispute greeting when DISPUTE call type is selected', async () => {
      const result = await voiceService.getInitialGreeting(testUser, {
        callType: 'DISPUTE',
        customerId,
      });

      expect(result.callType).toBe('DISPUTE');
      expect(result.greeting).toContain('ABC Tech');
      expect(result.greeting).toContain('billing query');
      expect(result.greeting.startsWith('You are Chotu, accounts reconciliation specialist')).toBe(false);
    });
  });

  describe('2. Multi-Turn Realistic Collections Dialogue Flow', () => {
    it('progresses through 4 conversational turns and confirms commitment to pay via UPI', async () => {
      let stage = 'GREETING_AND_VERIFICATION';
      let extractedData: any = {};

      // Turn 1: Customer asks who is calling
      const turn1 = await voiceService.processTurn(testUser, {
        customerId,
        userSpeech: 'Hello, who is calling?',
        currentStage: stage,
        turnCount: 0,
        extractedData,
      });

      expect(turn1.reply).toContain('Chotu');
      expect(turn1.reply).toContain('ABC Tech');
      expect(turn1.reply).not.toMatch(/remittance/i);
      stage = turn1.nextStage;
      extractedData = turn1.extractedData;

      // Turn 2: Customer explains cash flow delay
      const turn2 = await voiceService.processTurn(testUser, {
        customerId,
        userSpeech: 'We are facing a temporary cash flow delay this month',
        currentStage: stage,
        turnCount: 1,
        extractedData,
      });

      expect(turn2.reply).toMatch(/financial situation|cash flow|plan/i);
      stage = turn2.nextStage;
      extractedData = turn2.extractedData;

      // Turn 3: Customer proposes payment on next Friday via UPI
      const turn3 = await voiceService.processTurn(testUser, {
        customerId,
        userSpeech: 'Can we pay 25000 next Friday via UPI?',
        currentStage: stage,
        turnCount: 2,
        extractedData,
      });

      stage = turn3.nextStage;
      extractedData = turn3.extractedData;
      expect(extractedData.agreedAmount).toBe('₹25,000');
      expect(extractedData.paymentMethod).toBe('UPI');

      // Turn 4: Customer confirms the arrangement
      const turn4 = await voiceService.processTurn(testUser, {
        customerId,
        userSpeech: 'Yes, I confirm 25000 on next Friday via UPI',
        currentStage: stage,
        turnCount: 3,
        extractedData,
      });

      expect(turn4.outcome).toBe('PROMISE_TO_PAY');
      expect(turn4.extractedData.commitmentStatus).toBe('CONFIRMED');
      expect(turn4.extractedData.agreedAmount).toBe('₹25,000');
      expect(turn4.extractedData.paymentMethod).toBe('UPI');
    });
  });

  describe('3. Post-Call Summary Generation', () => {
    it('produces structured post-call summary with verified commitment details and next action', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId,
        invoiceNumber: 'INV-VERIFY-379220',
        durationSeconds: 120,
        callType: 'COLLECTIONS',
        outcome: 'PROMISE_TO_PAY',
        context: {
          commitmentStatus: 'CONFIRMED',
          agreedAmount: '₹25,000',
          promisedDate: 'next Friday',
          paymentMethod: 'UPI',
        },
        transcript: [
          { speaker: 'agent', text: 'Namaste! Am I speaking with ABC Tech?' },
          { speaker: 'customer', text: 'Hello, who is calling?' },
          { speaker: 'agent', text: 'I am Chotu from the finance desk regarding your balance of ₹25,000' },
          { speaker: 'customer', text: 'Yes, I confirm 25000 on next Friday via UPI' },
        ],
      });

      expect(summary.outcomeCategory).toBe('PROMISE_TO_PAY');
      expect(summary.paymentCommitment).toBe('CONFIRMED');
      expect(summary.commitmentAmount).toBe('₹25,000');
      expect(summary.commitmentDate).toBe('next Friday');
      expect(summary.paymentMethod).toBe('UPI');
      expect(summary.shortSummary).toContain('PTP Confirmed');
      expect(summary.shortSummary).toContain('ABC Tech agreed to pay ₹25,000');
      expect(summary.nextAction).toContain('Track bank credit');
    });
  });

  describe('4. Recording Pipeline and File Persistence', () => {
    it('validates audio upload, persists file into tenant directory, and updates CallSession metadata', async () => {
      // 1. Create a call session in the database
      const call = await callsService.create(testUser, {
        customerId,
        type: 'INBOUND',
        status: 'COMPLETED',
        duration: 95,
        outcome: 'PROMISE_TO_PAY',
      });

      expect(call.id).toBeDefined();

      // 2. Reject empty buffer
      const emptyBuffer = Buffer.alloc(0);
      await expect(
        callsService.saveRecording(call.id, testUser, emptyBuffer, 'audio/webm', 95),
      ).rejects.toThrow(/cannot be empty/i);

      // 3. Accept valid 256-byte audio buffer
      const audioBuffer = Buffer.alloc(256, 0xaa);
      const updatedCall = await callsService.saveRecording(
        call.id,
        testUser,
        audioBuffer,
        'audio/webm',
        95,
      );

      const metadata = updatedCall.metadata as any;
      expect(metadata).toBeDefined();
      expect(metadata.recording).toBeDefined();
      expect(metadata.recording.mimeType).toBe('audio/webm');
      expect(metadata.recording.size).toBe(256);
      expect(metadata.recording.duration).toBe(95);
      expect(metadata.recording.storagePath).toContain(testUser.tenantId);

      // 4. Verify physical file exists on disk
      const resolvedFile = await callsService.getRecordingFilePath(call.id, testUser);
      const fullPath = resolvedFile?.filePath || (fs.existsSync(path.resolve('uploads/recordings', metadata.recording.storagePath))
        ? path.resolve('uploads/recordings', metadata.recording.storagePath)
        : path.resolve('services/api/uploads/recordings', metadata.recording.storagePath));
      expect(fs.existsSync(fullPath)).toBe(true);
      const diskBytes = fs.readFileSync(fullPath);
      expect(diskBytes.length).toBe(256);

      // 5. Verify retrieval file path and mimeType
      const resolved = await callsService.getRecordingFilePath(call.id, testUser);
      expect(resolved).not.toBeNull();
      expect(resolved?.mimeType).toBe('audio/webm');
      expect(fs.statSync(resolved!.filePath).size).toBe(256);

      // Clean up test file and call
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        await prisma.callSession.delete({ where: { id: call.id } });
      } catch {}
    });
  });
});
