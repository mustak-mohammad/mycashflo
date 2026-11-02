const BASE_URL = 'http://localhost:3000/api';

async function main() {
  console.log('================================================================================');
  console.log('🎙️  myCashFlo — Verification: Chotu AI Voice Chat 12+ Consecutive Turns');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Authenticate as agent
  console.log('Step 1: Authenticating as collections agent...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });

  const loginData = await loginRes.json();
  const token = loginData.tokens?.accessToken || loginData.accessToken;
  assert(loginRes.status === 200 && token, 'Agent authentication successful');

  // 2. Fetch customer list
  console.log('\nStep 2: Resolving test customer account...');
  const custRes = await fetch(`${BASE_URL}/customers?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const custData = await custRes.json();
  const customers = Array.isArray(custData?.data) ? custData.data : Array.isArray(custData) ? custData : [];
  assert(customers.length > 0, `Customer retrieved: ${customers[0]?.name} (${customers[0]?.id})`);
  const customer = customers[0];

  // 3. Request LiveKit Room Token
  console.log('\nStep 3: Requesting LiveKit room session token...');
  const tokenRes = await fetch(`${BASE_URL}/voice/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerId: customer.id }),
  });
  const tokenJson = await tokenRes.json();
  assert(tokenRes.status === 200 || tokenRes.status === 201, 'Voice room session token generated');
  assert(Boolean(tokenJson.token && tokenJson.roomName), `Room assigned: ${tokenJson.roomName} (TTL: ${tokenJson.expiresIn}s)`);

  // 4. Execute 13 Consecutive Turns
  console.log('\nStep 4: Executing 13 consecutive turns against /api/voice/conversation/turn...\n');

  const conversationTurns = [
    { text: 'Yes, speaking. How can I help you?', expectedStage: 'CONFIRM_BALANCE', desc: 'Turn 1: Identity & greeting' },
    { text: 'Yes, I have the statement in front of me.', expectedStage: 'ASK_FULL_PAYMENT', desc: 'Turn 2: Confirm balance' },
    { text: 'We cannot clear the full ₹25,000 right now.', expectedStage: 'NEGOTIATE_AMOUNT', desc: 'Turn 3: Full pay objection' },
    { text: 'We can pay ₹10,000 today.', expectedStage: 'ASK_PAYMENT_DATE', desc: 'Turn 4: Negotiate partial amount' },
    { text: 'By next Friday we will clear the rest.', expectedStage: 'ASK_DELAY_REASON', desc: 'Turn 5: State remittance date' },
    { text: 'Delayed client receivables this month.', expectedStage: 'PAYMENT_METHOD', desc: 'Turn 6: Delay reason' },
    { text: 'We will remit via UPI.', expectedStage: 'ASSISTANCE_CHECK', desc: 'Turn 7: Payment mode' },
    { text: 'Yes, please send the payment link and statement copy.', expectedStage: 'SUMMARIZE_COMMITMENT', desc: 'Turn 8: Assistance check / link request' },
    { text: 'Yes, I confirm this payment commitment for next Friday.', expectedStage: 'CLOSING', desc: 'Turn 9: Confirm commitment (Post-8 turn!)' },
    { text: 'What is the exact invoice number again?', expectedStage: 'CLOSING', desc: 'Turn 10: Follow-up invoice inquiry' },
    { text: 'Will you send an automated GST receipt after I pay?', expectedStage: 'CLOSING', desc: 'Turn 11: Follow-up receipt inquiry' },
    { text: 'Can I also have the bank details for NEFT if needed?', expectedStage: 'CLOSING', desc: 'Turn 12: Follow-up payment inquiry' },
    { text: 'Thank you for your help, goodbye!', expectedStage: 'CALL_ENDED', desc: 'Turn 13: Final farewell & call end' },
  ];

  let currentStage = 'GREETING_AND_VERIFICATION';
  let extractedData = {};
  let sessionId = `verify_voice_${Date.now()}`;

  for (let i = 0; i < conversationTurns.length; i++) {
    const t = conversationTurns[i];
    const turnNumber = i + 1;

    const turnRes = await fetch(`${BASE_URL}/voice/conversation/turn`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userSpeech: t.text,
        currentStage,
        customerId: customer.id,
        sessionId,
        extractedData,
        turnCount: i,
      }),
    });

    assert(turnRes.status === 200 || turnRes.status === 201, `Message ${turnNumber} HTTP 200 response`);
    const turnResult = await turnRes.json();

    console.log(`  [Turn ${turnNumber}] Customer: "${t.text}"`);
    console.log(`  [Turn ${turnNumber}] Agent: "${turnResult.reply}"`);
    console.log(`  [Turn ${turnNumber}] NextStage: ${turnResult.nextStage} | shouldEnd: ${turnResult.shouldEnd} | Outcome: ${turnResult.outcome || 'NONE'}`);

    if (turnNumber < 13) {
      assert(
        turnResult.nextStage !== 'CALL_ENDED',
        `Message ${turnNumber} did NOT prematurely end the conversation (Current: ${turnResult.nextStage})`
      );
    } else {
      assert(
        turnResult.nextStage === 'CALL_ENDED' && turnResult.shouldEnd === true,
        `Message 13 concluded conversation cleanly with CALL_ENDED and shouldEnd: true`
      );
    }

    assert(Boolean(turnResult.reply && turnResult.reply.length > 5), `Message ${turnNumber} produced valid spoken response`);

    currentStage = turnResult.nextStage;
    extractedData = turnResult.extractedData || extractedData;
  }

  // 5. Test Session Cleanup (Saving Call Session to DB)
  console.log('\nStep 5: Testing call session save & cleanup (/api/calls)...');
  const createCallRes = await fetch(`${BASE_URL}/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerId: customer.id,
      duration: 185,
      outcome: 'PROMISE_TO_PAY',
      livekitRoom: tokenJson.roomName,
      summary: '13-turn voice conversation test completed successfully with payment commitment confirmed.',
      transcript: '[CUSTOMER]: Yes speaking\n[AGENT]: Namaste\n[CUSTOMER]: Bye\n[AGENT]: Have a good day',
    }),
  });

  assert(createCallRes.status === 200 || createCallRes.status === 201, 'Call session persisted to database');
  const callCreated = await createCallRes.json();
  assert(Boolean(callCreated?.id), `Call session created with ID: ${callCreated?.id}`);

  // 6. Test Existing Text Chatbot (/api/chotu/chat) for Non-Regression
  console.log('\nStep 6: Verifying existing Chotu text chatbot (/api/chotu/chat)...');
  const chatRes = await fetch(`${BASE_URL}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'What is our current overdue invoice balance?',
      conversationId: `conv_${Date.now()}`,
      currentPage: '/dashboard',
    }),
  });

  assert(chatRes.status === 200 || chatRes.status === 201, 'Text chatbot endpoint responded HTTP 200');
  const chatData = await chatRes.json();
  assert(Boolean(chatData.reply && chatData.reply.length > 10), 'Text chatbot returned informative response without regression');

  // Summary
  console.log('\n================================================================================');
  console.log(`🏁 VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
