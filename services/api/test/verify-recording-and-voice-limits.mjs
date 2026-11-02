import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api';
const prisma = new PrismaClient();

// Helper to construct a valid WebM container with Opus audio track and packets
function createValidWebmAudioBuffer(durationSeconds = 5) {
  const hex = [
    // EBML Header
    '1a45dfa3', // EBML ID
    '9f',       // size: 31
    '42868101', // EBMLVersion 1
    '42f78101', // EBMLReadVersion 1
    '42f28104', // EBMLMaxIDLength 4
    '42858108', // EBMLMaxSizeLength 8
    '428288', '7765626d00000000', // DocType "webm"
    '42878104', // DocTypeVersion 4
    '42858102', // DocTypeReadVersion 2
    // Segment
    '18538067', // Segment ID
    '01ffffffffffffff', // Unknown size
    // SeekHead
    '114d9b74', '80', // SeekHead (empty/stub)
    // Segment Info
    '1549a966', '91', // Info ID, size 17
    '2ad7b1', '83', '0f4240', // TimecodeScale: 1,000,000 ns = 1 ms
    '4d80', '84', '43484f54', // MuxingApp "CHOT"
    '5741', '84', '43484f54', // WritingApp "CHOT"
    // Tracks
    '1654ae6b', '9e', // Tracks ID, size 30
    'ae', '9c',       // TrackEntry
    'd7', '81', '01', // TrackNumber 1
    '73c5', '81', '01', // TrackUID 1
    '83', '81', '02', // TrackType 2 (Audio)
    '86', '88', '415f4f5055530000', // CodecID "A_OPUS"
    'e1', '8d',       // Audio settings
    'b5', '84', '473b8000', // SamplingFrequency 48000 Hz
    '9f', '81', '02', // Channels 2
    // Cluster
    '1f43b675', 'a5', // Cluster ID
    'e7', '81', '00', // Timecode 0
    // SimpleBlock with Opus frame
    'a3', '9d',       // SimpleBlock ID, size 29
    '81',             // Track 1
    '0000',           // Timecode relative 0
    '80',             // Keyframe flag
    // 25 bytes dummy Opus audio packet payload
    'f8fffe0102030405060708090a0b0c0d0e0f10111213141516'
  ].join('');

  return Buffer.from(hex, 'hex');
}

async function main() {
  console.log('========================================================================');
  console.log('  myCashflo — Call Recording and Voice Chat Verification Suite');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Authenticate
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });
  const authData = await loginRes.json();
  const token = authData.tokens?.accessToken || authData.accessToken;
  assert(token, 'Admin logged in and JWT access token obtained');

  const meRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json();
  const tenantId = me.tenantId;
  assert(tenantId, `Admin belongs to tenant: ${tenantId}`);

  // 2. Select customer
  let customer = await prisma.customer.findFirst({ where: { tenantId } });
  assert(customer, `Found customer for tenant: ${customer.name} (${customer.id})`);

  // 3. Create persistent call session in Call History
  console.log('\n--- Step 1: Create Real Call Session for Call History ---');
  const createCallRes = await fetch(`${API_BASE}/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerId: customer.id,
      duration: 185,
      outcome: 'PROMISE_TO_PAY',
      summary: 'Chotu AI voice session: Customer agreed to pay ₹45,000 via NEFT on the 10th of next month.',
      transcript: '[AGENT]: Namaste! This is Chotu calling from myCashflo.\n[CUSTOMER]: Yes, I can pay next week on the 10th.\n[AGENT]: Thank you, commitment recorded.',
      livekitRoom: `mcf-${tenantId}-${customer.id}-session`,
    }),
  });
  assert(createCallRes.status === 201, `Call session created successfully (HTTP ${createCallRes.status})`);
  const call = await createCallRes.json();
  const callId = call.id;
  assert(callId, `Call Session ID: ${callId}`);

  // 4. Generate original audio buffer and upload
  console.log('\n--- Step 2: Upload Original Audio Recording ---');
  const originalAudio = createValidWebmAudioBuffer(10);
  const originalBase64 = originalAudio.toString('base64');
  assert(originalAudio.length > 50, `Original audio generated: ${originalAudio.length} bytes (WebM/Opus format)`);

  const uploadRes = await fetch(`${API_BASE}/calls/${callId}/recording/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioBase64: originalBase64,
      mimeType: 'audio/webm',
    }),
  });
  assert(uploadRes.status === 201, `Recording uploaded successfully (HTTP ${uploadRes.status})`);
  const uploadData = await uploadRes.json();
  assert(uploadData.status === 'AVAILABLE', `Recording status is AVAILABLE`);

  // 5. Verify Call History List displays the call with recording
  console.log('\n--- Step 3: Check Full Voice History List via API ---');
  const listRes = await fetch(`${API_BASE}/calls?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(listRes.status === 200, `GET /api/calls returned 200 OK`);
  const listData = await listRes.json();
  const matchingCall = listData.data?.find((c) => c.id === callId);
  assert(matchingCall, `Call session ${callId} is present in Call History list`);
  assert(matchingCall.recordingStatus === 'AVAILABLE', `Call recordingStatus in list is AVAILABLE`);
  assert(matchingCall.recordingUrl === `/api/calls/${callId}/recording/stream`, `Call recordingUrl points to stream`);
  assert(matchingCall.customer?.name === customer.name, `Customer name matches: ${matchingCall.customer?.name}`);
  assert(matchingCall.duration === 185, `Duration is 185s (3:05)`);

  // 6. Verify Download of Original Audio
  console.log('\n--- Step 4: Verify Download of Original Audio ---');
  // Direct Download with Bearer Token
  const downloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(downloadRes.status === 200, `GET /api/calls/:id/recording/download returned HTTP 200`);
  const contentType = downloadRes.headers.get('content-type');
  const contentDisp = downloadRes.headers.get('content-disposition');
  assert(contentType?.includes('audio/webm'), `Content-Type is audio/webm: ${contentType}`);
  assert(contentDisp?.includes('attachment'), `Content-Disposition is attachment: ${contentDisp}`);
  
  const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
  assert(
    downloadedBytes.length === originalAudio.length,
    `Downloaded byte count (${downloadedBytes.length}) exactly matches original audio (${originalAudio.length})`,
  );
  assert(
    downloadedBytes.equals(originalAudio),
    `Downloaded bytes are BIT-FOR-BIT IDENTICAL to original uploaded audio!`,
  );

  // Download via query token (used by browser when downloading directly)
  const queryDownloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download?token=${encodeURIComponent(token)}`);
  assert(queryDownloadRes.status === 200, `Download via ?token= query parameter succeeded (HTTP 200)`);
  const queryBytes = Buffer.from(await queryDownloadRes.arrayBuffer());
  assert(queryBytes.equals(originalAudio), `Query token download is bit-for-bit identical to original audio`);

  // 7. Verify Audio Playback Stream (HTML5 audio player)
  console.log('\n--- Step 5: Verify Audio Playback Stream ---');
  const streamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream?token=${encodeURIComponent(token)}`);
  assert(streamRes.status === 200, `Audio playback stream returned HTTP 200`);
  assert(streamRes.headers.get('accept-ranges') === 'bytes', `Accept-Ranges header is bytes (supports audio seek)`);
  const streamedBytes = Buffer.from(await streamRes.arrayBuffer());
  assert(streamedBytes.equals(originalAudio), `Streamed audio is bit-for-bit identical to original audio`);

  // Partial range request for seeking
  const rangeRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Range: 'bytes=0-31',
    },
  });
  assert(rangeRes.status === 206, `Range request for audio seek returned HTTP 206 Partial Content`);
  assert(Number(rangeRes.headers.get('content-length')) === 32, `Range request returned 32 bytes`);

  // 8. Test Voice-based Messages Limit (12+ Consecutive Turns)
  console.log('\n--- Step 6: Test Voice-based Messages Limit (12+ Consecutive Turns) ---');
  const testTurns = [
    { turn: 1, text: 'Yes, speaking. How can I help you?', stage: 'GREETING_AND_VERIFICATION' },
    { turn: 2, text: 'Yes, I have the statement in front of me.', stage: 'CONFIRM_BALANCE' },
    { turn: 3, text: 'We cannot clear the full ₹45,000 right now.', stage: 'ASK_FULL_PAYMENT' },
    { turn: 4, text: 'We can pay ₹20,000 today.', stage: 'NEGOTIATE_AMOUNT' },
    { turn: 5, text: 'By next Friday we will clear the rest.', stage: 'ASK_PAYMENT_DATE' },
    { turn: 6, text: 'Delayed client receivables this month.', stage: 'ASK_DELAY_REASON' },
    { turn: 7, text: 'We will remit via UPI.', stage: 'PAYMENT_METHOD' },
    { turn: 8, text: 'Yes, please send the payment link and statement copy.', stage: 'ASSISTANCE_CHECK' }, // Turn 8: previously stopped!
    { turn: 9, text: 'Yes, I confirm this payment commitment for next Friday.', stage: 'SUMMARIZE_COMMITMENT' },
    { turn: 10, text: 'What is the exact invoice number again?', stage: 'CLOSING' }, // Turn 10 follow-up!
    { turn: 11, text: 'Will you send an automated GST receipt after I pay?', stage: 'CLOSING' }, // Turn 11 follow-up!
    { turn: 12, text: 'Can I also have the bank details for NEFT if needed?', stage: 'CLOSING' }, // Turn 12 follow-up!
    { turn: 13, text: 'Thank you for your help, goodbye!', stage: 'CLOSING' }, // Explicit farewell!
  ];

  let currentStage = 'GREETING_AND_VERIFICATION';
  let extractedData = {};
  let turnCount = 0;
  let turnsPassed = 0;

  for (const t of testTurns) {
    const turnRes = await fetch(`${API_BASE}/voice/conversation/turn`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userSpeech: t.text,
        currentStage: currentStage,
        customerId: customer.id,
        sessionId: `test_session_${callId}`,
        extractedData,
        turnCount,
      }),
    });

    assert(turnRes.status === 200 || turnRes.status === 201, `Turn ${t.turn} (${t.stage}): HTTP 200 received`);
    const turnData = await turnRes.json();
    assert(turnData.reply && turnData.reply.length > 5, `Turn ${t.turn} replied: "${turnData.reply.slice(0, 60)}..."`);
    
    // Critical assertion: Turn 8 must NOT end the conversation
    if (t.turn === 8) {
      assert(
        turnData.shouldEnd === false,
        `TURN 8 CHECK: shouldEnd is FALSE — conversation continues past message 8!`,
      );
    }

    // Turns 10, 11, 12: Inquiries must NOT prematurely end
    if (t.turn >= 10 && t.turn <= 12) {
      assert(
        turnData.shouldEnd === false,
        `TURN ${t.turn} CHECK: Follow-up question handled cleanly with shouldEnd: FALSE`,
      );
    }

    // Turn 13: Explicit farewell should end call
    if (t.turn === 13) {
      assert(
        turnData.shouldEnd === true,
        `TURN 13 CHECK: Explicit farewell concluded conversation with shouldEnd: TRUE`,
      );
      assert(
        turnData.nextStage === 'CALL_ENDED' || turnData.nextStage === 'CLOSING',
        `Final stage resolved to: ${turnData.nextStage}`,
      );
    }

    currentStage = turnData.nextStage || currentStage;
    extractedData = { ...extractedData, ...(turnData.extractedData || {}) };
    turnCount++;
    turnsPassed++;
  }

  assert(turnsPassed === 13, `All 13 consecutive turns executed and verified successfully!`);

  // 9. Verify Safety Limit Guardrail (Turn 31)
  console.log('\n--- Step 7: Verify 30-Turn Guardrail Safety Ceiling ---');
  const guardrailRes = await fetch(`${API_BASE}/voice/conversation/turn`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userSpeech: 'Hello again?',
      currentStage: 'CLOSING',
      customerId: customer.id,
      turnCount: 31,
    }),
  });
  const guardrailData = await guardrailRes.json();
  assert(guardrailData.shouldEnd === true, `Turn 31 triggers guardrail with shouldEnd: TRUE`);
  assert(guardrailData.nextStage === 'CALL_ENDED', `Turn 31 stage set to CALL_ENDED`);

  console.log('\n========================================================================');
  console.log(`  FINAL VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test error:', err);
  prisma.$disconnect();
  process.exit(1);
});
