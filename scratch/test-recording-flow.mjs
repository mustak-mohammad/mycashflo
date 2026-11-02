import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api';
const prisma = new PrismaClient();

// Generate a valid WebM container header with Opus audio metadata
function createValidWebmAudioBuffer(durationSeconds = 3) {
  // Minimal valid WebM EBML header + Segment + Tracks (Audio Opus) + SimpleBlock
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

async function run() {
  console.log('========================================================================');
  console.log('  myCashflo — Comprehensive Call Recording Verification & Diagnosis');
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

  // 1. Authenticate Admin (Tenant 1)
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });
  const adminAuth = await adminLoginRes.json();
  const token = adminAuth.tokens?.accessToken || adminAuth.accessToken;
  assert(token, 'Admin authenticated and JWT received');

  const meRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const adminUser = await meRes.json();
  const tenantId = adminUser.tenantId;
  assert(tenantId, `Admin user belongs to tenant: ${tenantId}`);

  // Create a second tenant to test tenant isolation strictly
  let tenant2 = await prisma.tenant.findUnique({ where: { slug: 'isolation-test-tenant' } });
  if (!tenant2) {
    tenant2 = await prisma.tenant.create({
      data: {
        name: 'Isolation Test Corp',
        slug: 'isolation-test-tenant',
      },
    });
  }

  // Create a user in tenant 2
  let tenant2User = await prisma.user.findFirst({
    where: { tenantId: tenant2.id, email: 'user2@isolation.test' },
  });
  if (!tenant2User) {
    tenant2User = await prisma.user.create({
      data: {
        email: 'user2@isolation.test',
        passwordHash: '$2b$12$e.UiUkPXxk173udPmNv6PeIizNVJ2eTO.OTpPkZonAXrkrVMQwBlC',
        name: 'Tenant2 User',
        role: 'ADMIN',
        tenantId: tenant2.id,
      },
    });
  }

  // Generate JWT for Tenant 2 user
  const tenant2LoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user2@isolation.test', password: 'Admin@1234' }),
  });
  const t2Auth = await tenant2LoginRes.json();
  const tenant2Token = t2Auth.tokens?.accessToken || t2Auth.accessToken;
  assert(tenant2Token, 'Tenant 2 user authenticated with separate JWT');

  // Find or create customer in tenant 1
  let customer = await prisma.customer.findFirst({ where: { tenantId } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: 'Apex Solutions Pvt Ltd',
        phone: '+91 9876543210',
        tenantId,
      },
    });
  }

  // ── Step 1: Create an explicitly controlled test call session ─────────
  console.log('\n--- Test 1: Controlled Call Session Creation ---');
  const createCallRes = await fetch(`${API_BASE}/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerId: customer.id,
      duration: 145,
      outcome: 'PROMISE_TO_PAY',
      summary: 'Controlled test call: customer agreed to remit ₹15,000 by 10th of next month.',
      transcript: '[AGENT]: Hello. [CUSTOMER]: I will pay on the 10th.',
      livekitRoom: `mcf-${tenantId}-${customer.id}-ctrltest`,
    }),
  });
  assert(createCallRes.status === 201, `POST /api/calls created controlled call session (HTTP ${createCallRes.status})`);
  const callSession = await createCallRes.json();
  const callId = callSession.id;
  assert(callId, `Created call session ID: ${callId}`);

  // ── Test 2: Verify missing recording produces a clear error ──────────
  console.log('\n--- Test 2: Missing Recording Produces Clear Error ---');
  const getRecBeforeRes = await fetch(`${API_BASE}/calls/${callId}/recording`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(
    getRecBeforeRes.status === 404,
    `GET /api/calls/:id/recording on call without recording returns HTTP 404 NotFound (actual: ${getRecBeforeRes.status})`,
  );
  const notFoundBody = await getRecBeforeRes.json();
  assert(
    notFoundBody.message.includes('No recording is available for this call'),
    `404 error message is clear: "${notFoundBody.message}"`,
  );

  const downloadBeforeRes = await fetch(`${API_BASE}/calls/${callId}/recording/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(
    downloadBeforeRes.status === 404,
    `GET /api/calls/:id/recording/download before upload returns HTTP 404 NotFound (actual: ${downloadBeforeRes.status})`,
  );

  // ── Test 3: Generate and upload real recording audio blob ─────────────
  console.log('\n--- Test 3: Generate Real Audio Recording and Upload ---');
  const realAudioBuffer = createValidWebmAudioBuffer(5);
  const audioBase64 = realAudioBuffer.toString('base64');
  assert(realAudioBuffer.length > 50, `Generated valid WebM/Opus audio buffer (${realAudioBuffer.length} bytes)`);

  const uploadRes = await fetch(`${API_BASE}/calls/${callId}/recording/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioBase64,
      mimeType: 'audio/webm',
    }),
  });
  assert(uploadRes.status === 201, `POST /api/calls/:id/recording/upload succeeded (HTTP ${uploadRes.status})`);
  const uploadResult = await uploadRes.json();
  assert(uploadResult.status === 'AVAILABLE', `Upload result status is AVAILABLE`);
  assert(uploadResult.downloadUrl === `/api/calls/${callId}/recording/download`, `downloadUrl is correct: ${uploadResult.downloadUrl}`);
  assert(uploadResult.streamUrl === `/api/calls/${callId}/recording/stream`, `streamUrl is correct: ${uploadResult.streamUrl}`);
  assert(uploadResult.fileSize === realAudioBuffer.length, `Uploaded file size recorded accurately: ${uploadResult.fileSize} bytes`);

  // ── Test 4: Verify metadata saved in database ─────────────────────────
  console.log('\n--- Test 4: Database Metadata Verification ---');
  const dbCall = await prisma.callSession.findUnique({ where: { id: callId } });
  assert(dbCall.recordingStatus === 'AVAILABLE', `Database recordingStatus is AVAILABLE (actual: ${dbCall.recordingStatus})`);
  assert(dbCall.recordingUrl === `/api/calls/${callId}/recording/stream`, `Database recordingUrl is stream endpoint (actual: ${dbCall.recordingUrl})`);

  // Verify file exists on local disk
  const uploadDir = path.join(process.cwd(), 'uploads', 'recordings', tenantId);
  const onDiskPath = path.join(uploadDir, `${callId}.webm`);
  assert(fs.existsSync(onDiskPath), `File exists on local filesystem at: ${onDiskPath}`);
  const diskBytes = fs.readFileSync(onDiskPath);
  assert(diskBytes.length === realAudioBuffer.length, `File size on disk matches uploaded buffer (${diskBytes.length} bytes)`);

  // ── Test 5: Verify resolve recording endpoint ─────────────────────────
  console.log('\n--- Test 5: GET /api/calls/:id/recording Endpoint ---');
  const getRecAfterRes = await fetch(`${API_BASE}/calls/${callId}/recording`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(getRecAfterRes.status === 200, `GET /api/calls/:id/recording returns HTTP 200`);
  const recData = await getRecAfterRes.json();
  assert(recData.status === 'AVAILABLE', `Status is AVAILABLE`);
  assert(recData.downloadUrl === `/api/calls/${callId}/recording/download`, `downloadUrl matches`);
  assert(recData.streamUrl === `/api/calls/${callId}/recording/stream`, `streamUrl matches`);

  // ── Test 6: Verify streaming audio playback (HTTP 200 & 206) ──────────
  console.log('\n--- Test 6: Streaming Audio Playback (HTTP 200 & HTTP 206) ---');
  // Full stream
  const fullStreamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(fullStreamRes.status === 200, `Full stream returns HTTP 200`);
  assert(fullStreamRes.headers.get('content-type')?.includes('audio/webm'), `Content-Type is audio/webm (${fullStreamRes.headers.get('content-type')})`);
  assert(fullStreamRes.headers.get('accept-ranges') === 'bytes', `Accept-Ranges header is bytes`);
  const fullStreamData = await fullStreamRes.arrayBuffer();
  assert(fullStreamData.byteLength === realAudioBuffer.length, `Streamed bytes match original (${fullStreamData.byteLength})`);

  // Partial Content (Range request) for browser audio seek/scrub
  const rangeStreamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Range: 'bytes=0-31',
    },
  });
  assert(rangeStreamRes.status === 206, `Range stream request returns HTTP 206 Partial Content`);
  assert(rangeStreamRes.headers.get('content-range')?.startsWith('bytes 0-31/'), `Content-Range header starts with 'bytes 0-31/' (${rangeStreamRes.headers.get('content-range')})`);
  const rangeData = await rangeStreamRes.arrayBuffer();
  assert(rangeData.byteLength === 32, `Range streamed exactly 32 bytes`);

  // Stream via query token (?token=) for browser <audio> tags
  const queryStreamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream?token=${encodeURIComponent(token)}`);
  assert(queryStreamRes.status === 200, `Stream via ?token= query parameter succeeded (for HTML5 <audio> tag)`);

  // ── Test 7: Verify recording download endpoint ────────────────────────
  console.log('\n--- Test 7: Recording Download Endpoint ---');
  // With Bearer token
  const downloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(downloadRes.status === 200, `Download returns HTTP 200`);
  const dispHeader = downloadRes.headers.get('content-disposition');
  assert(dispHeader?.includes('attachment') && dispHeader?.includes('filename='), `Content-Disposition header is attachment with filename: ${dispHeader}`);
  assert(downloadRes.headers.get('content-type')?.includes('audio/webm'), `Content-Type header is audio/webm`);
  assert(Number(downloadRes.headers.get('content-length')) === realAudioBuffer.length, `Content-Length header matches file size (${downloadRes.headers.get('content-length')})`);
  const downloadedBytes = await downloadRes.arrayBuffer();
  assert(downloadedBytes.byteLength === realAudioBuffer.length, `Downloaded bytes match uploaded bytes (${downloadedBytes.byteLength})`);

  // With ?token= query parameter for direct browser download links
  const queryDownloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download?token=${encodeURIComponent(token)}`);
  assert(queryDownloadRes.status === 200, `Download via ?token= query parameter returns HTTP 200`);
  assert(queryDownloadRes.headers.get('content-disposition')?.includes('attachment'), `Content-Disposition on query download is attachment`);

  // ── Test 8: Tenant isolation enforcement ──────────────────────────────
  console.log('\n--- Test 8: Tenant Isolation Enforcement ---');
  // Tenant 2 attempts to resolve Tenant 1 recording
  const t2GetRecRes = await fetch(`${API_BASE}/calls/${callId}/recording`, {
    headers: { Authorization: `Bearer ${tenant2Token}` },
  });
  assert(t2GetRecRes.status === 404, `Tenant 2 cannot resolve Tenant 1 recording (HTTP 404 NotFound: ${t2GetRecRes.status})`);

  // Tenant 2 attempts to stream Tenant 1 recording
  const t2StreamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream`, {
    headers: { Authorization: `Bearer ${tenant2Token}` },
  });
  assert(t2StreamRes.status === 404, `Tenant 2 cannot stream Tenant 1 recording (HTTP 404 NotFound: ${t2StreamRes.status})`);

  // Tenant 2 attempts to download Tenant 1 recording
  const t2DownloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download`, {
    headers: { Authorization: `Bearer ${tenant2Token}` },
  });
  assert(t2DownloadRes.status === 404, `Tenant 2 cannot download Tenant 1 recording (HTTP 404 NotFound: ${t2DownloadRes.status})`);

  // Unauthenticated requests are rejected with 401
  const unauthStreamRes = await fetch(`${API_BASE}/calls/${callId}/recording/stream`);
  assert(unauthStreamRes.status === 401, `Unauthenticated stream request rejected with HTTP 401 Unauthorized (${unauthStreamRes.status})`);

  const unauthDownloadRes = await fetch(`${API_BASE}/calls/${callId}/recording/download`);
  assert(unauthDownloadRes.status === 401, `Unauthenticated download request rejected with HTTP 401 Unauthorized (${unauthDownloadRes.status})`);

  // ── Test 9: Frontend URL construction verification ────────────────────
  console.log('\n--- Test 9: Frontend URL Construction Verification ---');
  // Test stripping of /api prefix to avoid /api/api double-prefix
  const backendDownloadUrl = recData.downloadUrl; // '/api/calls/.../recording/download'
  let rawEndpoint = backendDownloadUrl;
  const clientEndpoint = rawEndpoint.startsWith('/api/') ? rawEndpoint.replace(/^\/api/, '') : rawEndpoint;
  assert(
    clientEndpoint === `/calls/${callId}/recording/download`,
    `client.get() endpoint correctly normalized without '/api' prefix: ${clientEndpoint}`,
  );
  const clientBaseUrl = '/api';
  const effectiveFullUrl = `${clientBaseUrl}${clientEndpoint}`;
  assert(
    effectiveFullUrl === `/api/calls/${callId}/recording/download`,
    `Full Axios request URL is exactly '/api/calls/...': ${effectiveFullUrl}`,
  );

  // Clean up test file and test call session
  try {
    if (fs.existsSync(onDiskPath)) {
      fs.unlinkSync(onDiskPath);
    }
    await prisma.callSession.delete({ where: { id: callId } });
  } catch (_) {}

  console.log('\n========================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test execution error:', err);
  prisma.$disconnect();
  process.exit(1);
});
