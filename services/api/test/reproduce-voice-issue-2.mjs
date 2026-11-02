import { PrismaClient } from '@prisma/client';
import { VoiceService } from '../dist/voice/voice.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('================================================================');
  console.log('STANDARD 8-STAGE PROGRESSION -> ATTEMPTING 12 CONSECUTIVE TURNS');
  console.log('================================================================\n');

  const customer = await prisma.customer.findFirst();
  const user = { userId: 'user_001', tenantId: customer.tenantId, role: 'AGENT' };

  const mockConfig = {
    get: (key) => (key === 'LIVEKIT_URL' ? 'wss://livekit.test.com' : 'secret'),
  };
  const mockRecorder = {
    startRoomRecording: async () => 'egress_test',
    stopRecording: async () => {},
    getRecording: async () => ({ status: 'COMPLETE' }),
  };

  const voiceService = new VoiceService(mockConfig, prisma, mockRecorder);
  const sessionId = `test_voice_session_${Date.now()}`;
  let currentStage = 'GREETING_AND_VERIFICATION';
  let extractedData = {};
  let turnCount = 0;

  // The 10-stage flow progressing step by step:
  const conversationTurns = [
    { text: 'Yes, this is accounts.', label: 'Turn 1: Identity' },
    { text: 'Yes, we have received the statement.', label: 'Turn 2: Balance' },
    { text: 'No, we cannot pay in full right now.', label: 'Turn 3: Full Pay Objection' },
    { text: '10000', label: 'Turn 4: Negotiate partial amount' },
    { text: 'Friday', label: 'Turn 5: Date' },
    { text: 'Delay in client remittance.', label: 'Turn 6: Reason' },
    { text: 'NetBanking', label: 'Turn 7: Payment Method' },
    { text: 'No, do not send WhatsApp link.', label: 'Turn 8: Assistance check' },
    { text: 'Wait, what is our total balance?', label: 'Turn 9: Follow-up question' },
    { text: 'Can we pay 5000 first?', label: 'Turn 10: Renegotiation' },
    { text: 'Who is our account manager?', label: 'Turn 11: Inquiry' },
    { text: 'Okay, thanks.', label: 'Turn 12: Wrap up' },
  ];

  let firstFailureTurn = null;

  for (let i = 0; i < conversationTurns.length; i++) {
    const turn = conversationTurns[i];
    const turnNum = i + 1;
    console.log(`\n--- Message ${turnNum} [Current Stage: ${currentStage}] ---`);
    console.log(`Customer: "${turn.text}" (${turn.label})`);

    try {
      const result = await voiceService.processTurn(user, {
        userSpeech: turn.text,
        currentStage,
        customerId: customer.id,
        sessionId,
        extractedData,
        turnCount,
      });

      console.log(`Agent reply: "${result.reply}"`);
      console.log(`Next Stage: ${result.nextStage} | Should End: ${result.shouldEnd} | Outcome: ${result.outcome || 'NONE'}`);

      currentStage = result.nextStage;
      extractedData = result.extractedData || extractedData;
      turnCount++;

      if (result.shouldEnd && !firstFailureTurn && turnNum < conversationTurns.length) {
        firstFailureTurn = turnNum;
        console.log(`\n🚨 PREMATURE TERMINATION DETECTED AT MESSAGE ${turnNum}! (shouldEnd: true)`);
      }
    } catch (err) {
      console.error(`Error at turn ${turnNum}:`, err.message);
      if (!firstFailureTurn) firstFailureTurn = turnNum;
    }
  }

  console.log('\n================================================================');
  console.log(`First premature shouldEnd: Message ${firstFailureTurn}`);
  console.log('================================================================\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
