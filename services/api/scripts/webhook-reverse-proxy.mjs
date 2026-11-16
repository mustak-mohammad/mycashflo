import http from 'node:http';

const PROXY_PORT = 3050;
const PROXY_HOST = '127.0.0.1';
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3000;
const ALLOWED_PATH = '/api/payments/webhook/razorpay';
const ALLOWED_METHOD = 'POST';
const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB strict limit

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const server = http.createServer((req, res) => {
  // Safe URL parsing with trusted fixed base
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, 'http://127.0.0.1');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 400, message: 'Malformed request URL', error: 'Bad Request' }));
    return;
  }

  // 1. Strict Allowlist: Reject everything except POST /api/payments/webhook/razorpay
  if (parsedUrl.pathname !== ALLOWED_PATH || req.method !== ALLOWED_METHOD) {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [BLOCKED] ${req.method} ${parsedUrl.pathname} from ${req.socket.remoteAddress}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      statusCode: 404,
      message: `Cannot ${req.method} ${parsedUrl.pathname}`,
      error: 'Not Found',
    }));
    return;
  }

  // 2. Header sanitization: strip auth, cookies, hop-by-hop headers
  const forwardedHeaders = {};
  for (const [key, val] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'authorization' ||
      lowerKey === 'cookie' ||
      lowerKey.startsWith('x-forwarded-user') ||
      lowerKey.startsWith('x-tenant') ||
      HOP_BY_HOP_HEADERS.has(lowerKey)
    ) {
      continue;
    }
    forwardedHeaders[key] = val;
  }
  forwardedHeaders['host'] = `${TARGET_HOST}:${TARGET_PORT}`;

  // 3. Forward request with fixed path (no query pollution) and 15s timeout
  const proxyReq = http.request(
    {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: ALLOWED_PATH,
      method: ALLOWED_METHOD,
      headers: forwardedHeaders,
      timeout: 15000,
    },
    (proxyRes) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [FORWARDED] POST ${ALLOWED_PATH} -> Upstream HTTP ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Upstream timeout'));
  });

  proxyReq.on('error', (err) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [UPSTREAM ERROR] Connection to NestJS failed: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 502, message: 'Upstream myCashFlo API unavailable', error: 'Bad Gateway' }));
    }
  });

  // 4. Payload size guard & raw stream piping
  let receivedBytes = 0;
  req.on('data', (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_PAYLOAD_BYTES) {
      req.pause();
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: 413, message: 'Payload Too Large', error: 'Payload Too Large' }));
      }
    }
  });

  req.on('error', () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
});

// Enforce Slowloris timeouts
server.requestTimeout = 15000;
server.headersTimeout = 20000;

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`🛡️  Hardened Razorpay Webhook Proxy active on http://${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`   Allowed: POST ${ALLOWED_PATH} (max ${MAX_PAYLOAD_BYTES / 1024} KB)`);
  console.log(`   Target:  http://${TARGET_HOST}:${TARGET_PORT}${ALLOWED_PATH}`);
  console.log(`   All other routes/methods are rejected with HTTP 404.`);
});
