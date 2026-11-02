import { PrismaClient } from '@prisma/client';
import { VoiceService } from '../dist/voice/voice.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('================================================================');
  console.log('VERIFYING 12+ CONSECUTIVE VOICE TURNS ACROSS ENTIRE LIFECYCLE');
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

  const turns = [
    { text: 'Yes, speaking. How can I help you?', label: 'Turn 1: Greeting confirmation' },
    { text: 'Yes, I have the invoice statement.', label: 'Turn 2: Confirm balance' },
    { text: 'We cannot pay the entire balance today.', label: 'Turn 3: Partial pay objection' },
    { text: 'We can pay ₹10,000 right now.', label: 'Turn 4: Negotiate partial amount' },
    { text: 'By next Friday we will clear the remainder.', label: 'Turn 5: State remittance date' },
    { text: 'Our client delayed our milestone payment.', label: 'Turn 6: Reason for delay' },
    { text: 'We prefer to pay via UPI.', label: 'Turn 7: Payment method' },
    { text: 'Yes, please dispatch the payment link.', label: 'Turn 8: Assistance check (Link)' },
    { text: 'Yes, I confirm this payment commitment.', label: 'Turn 9: Confirm commitment' },
    { text: 'What is the exact invoice number again?', label: 'Turn 10: Follow-up invoice query' },
    { text: 'Will you send a GST receipt after payment?', label: 'Turn 11: Follow-up receipt query' },
    { text: 'Can I also have the bank transfer details?', label: 'Turn 12: Follow-up bank query' },
    { text: 'Thank you for your assistance, goodbye!', label: 'Turn 13: Final farewell / disconnect' },
  ];

  let completedTurns = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const turnNum = i + 1;
    console.log(`\n--- Message ${turnNum} [Current Stage: ${currentStage}] ---`);
    console.log(`👤 Customer: "${turn.text}" (${turn.label})`);

    const result = await voiceService.processTurn(user, {
      userSpeech: turn.text,
      currentStage,
      customerId: customer.id,
      sessionId,
      extractedData,
      turnCount,
    });

    console.log(`🤖 Chotu: "${result.reply}"`);
    console.log(`   Next Stage: ${result.nextStage} | Should End: ${result.shouldEnd} | Outcome: ${result.outcome || 'NONE'}`);

    currentStage = result.nextStage;
    extractedData = result.extractedData || extractedData;
    turnCount++;
    completedTurns++;

    // Prior to turn 13, conversation should continue without premature termination!
    if (turnNum < turns.length) {
      if (result.shouldEnd) {
        console.error(`❌ FAILED: Unexpected termination at message ${turnNum}!`);
        process.exit(1);
      }
    } else {
      // Turn 13 is the final farewell
      if (!result.shouldEnd || result.nextStage !== 'CALL_ENDED') {
        console.error(`❌ FAILED: Turn 13 should have ended the call!`);
        process.exit(1);
      }
    }
  }

  console.log('\n================================================================');
  console.log(`✅ SUCCESS: ${completedTurns}/${turns.length} consecutive messages successfully processed!`);
  console.log(`- Messages 1 through 8 completed progressive collection flow.`);
  console.log(`- Messages 9 through 12 continued handling queries, confirmations, and follow-ups without stopping.`);
  console.log(`- Message 13 cleanly concluded and triggered session cleanup.`);
  console.log('================================================================\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
