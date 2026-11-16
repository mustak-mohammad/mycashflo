import { parseIntegrationEncryptionKey } from './secret-encryption.util.js';

/**
 * Startup Environment Variable Validation
 *
 * Validates critical environment variables required by the application.
 * Fails fast with clear names of missing or malformed configuration
 * without EVER leaking secret values into error messages or logs.
 */

export interface ValidatedEnvironment {
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  PORT?: number;
  WEB_ORIGIN?: string;
  NODE_ENV?: string;
  OUTBOUND_CALLS_ENABLED?: string;
  ENABLE_OUTBOUND_CALLS?: string;
  AUTOMATED_REMINDERS_ENABLED?: string;
  REMINDERS_TEST_MODE?: string;
  WHATSAPP_TEST_RECIPIENT?: string;
  [key: string]: unknown;
}

export function validateEnvironment(config: Record<string, unknown>): ValidatedEnvironment {
  const errors: string[] = [];

  // 1. DATABASE_URL
  const dbUrl = config.DATABASE_URL;
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    errors.push('DATABASE_URL is required (must be a valid PostgreSQL connection string)');
  } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection URI starting with postgresql:// or postgres://');
  }

  // 2. JWT_ACCESS_SECRET
  const jwtAccess = config.JWT_ACCESS_SECRET;
  if (!jwtAccess || typeof jwtAccess !== 'string' || jwtAccess.trim() === '') {
    errors.push('JWT_ACCESS_SECRET is required');
  } else if (jwtAccess.length < 16) {
    errors.push('JWT_ACCESS_SECRET must be at least 16 characters for cryptographic safety');
  }

  // 3. JWT_REFRESH_SECRET
  const jwtRefresh = config.JWT_REFRESH_SECRET;
  if (!jwtRefresh || typeof jwtRefresh !== 'string' || jwtRefresh.trim() === '') {
    errors.push('JWT_REFRESH_SECRET is required');
  } else if (jwtRefresh.length < 16) {
    errors.push('JWT_REFRESH_SECRET must be at least 16 characters for cryptographic safety');
  }

  // 4. PORT (optional, default 3000)
  if (config.PORT !== undefined && config.PORT !== null && config.PORT !== '') {
    const portNum = Number(config.PORT);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      errors.push('PORT must be a valid integer between 1 and 65535');
    }
  }

  // 5. RESEND_API_KEY (optional, but if provided must be a valid key format)
  if (config.RESEND_API_KEY !== undefined && config.RESEND_API_KEY !== null && config.RESEND_API_KEY !== '') {
    const resendKey = String(config.RESEND_API_KEY).trim();
    if (!resendKey.startsWith('re_') && !resendKey.startsWith('mock_') && !resendKey.startsWith('sim_')) {
      errors.push('RESEND_API_KEY must be a valid Resend API key starting with re_');
    }
  }

  // 6. EMAIL_FROM (optional, must be formatted email if provided)
  if (config.EMAIL_FROM !== undefined && config.EMAIL_FROM !== null && config.EMAIL_FROM !== '') {
    const fromStr = String(config.EMAIL_FROM).trim();
    if (!fromStr.includes('@')) {
      errors.push('EMAIL_FROM must be a valid email address or "Sender Name <email@example.com>"');
    }
  }

  // 7. EMAIL_TEST_RECIPIENT (optional, must be valid email if provided)
  if (config.EMAIL_TEST_RECIPIENT !== undefined && config.EMAIL_TEST_RECIPIENT !== null && config.EMAIL_TEST_RECIPIENT !== '') {
    const testRecip = String(config.EMAIL_TEST_RECIPIENT).trim();
    if (!testRecip.includes('@')) {
      errors.push('EMAIL_TEST_RECIPIENT must be a valid email address');
    }
  }

  // 8. AUTOMATED_REMINDERS_ENABLED (optional, boolean string 'true' or 'false')
  if (
    config.AUTOMATED_REMINDERS_ENABLED !== undefined &&
    config.AUTOMATED_REMINDERS_ENABLED !== null &&
    config.AUTOMATED_REMINDERS_ENABLED !== ''
  ) {
    const flag = String(config.AUTOMATED_REMINDERS_ENABLED).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('AUTOMATED_REMINDERS_ENABLED must be "true" or "false"');
    }
  }

  // 9. REMINDERS_TEST_EMAIL_DELIVERY_ENABLED (optional, boolean string 'true' or 'false')
  if (
    config.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED !== undefined &&
    config.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED !== null &&
    config.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED !== ''
  ) {
    const flag = String(config.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('REMINDERS_TEST_EMAIL_DELIVERY_ENABLED must be "true" or "false"');
    }
  }

  // 10. REMINDERS_TEST_MODE (optional, boolean string 'true' or 'false')
  if (
    config.REMINDERS_TEST_MODE !== undefined &&
    config.REMINDERS_TEST_MODE !== null &&
    config.REMINDERS_TEST_MODE !== ''
  ) {
    const flag = String(config.REMINDERS_TEST_MODE).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('REMINDERS_TEST_MODE must be "true" or "false"');
    }
  }

  // 11. WHATSAPP_TEST_RECIPIENT (optional, must be numeric phone string if provided)
  if (
    config.WHATSAPP_TEST_RECIPIENT !== undefined &&
    config.WHATSAPP_TEST_RECIPIENT !== null &&
    config.WHATSAPP_TEST_RECIPIENT !== ''
  ) {
    const cleanDigits = String(config.WHATSAPP_TEST_RECIPIENT).replace(/[^\d]/g, '');
    if (cleanDigits.length < 8) {
      errors.push('WHATSAPP_TEST_RECIPIENT must be a valid phone number (at least 8 digits)');
    }
  }

  // 12. ENABLE_OUTBOUND_CALLS (optional, boolean string 'true' or 'false')
  if (
    config.ENABLE_OUTBOUND_CALLS !== undefined &&
    config.ENABLE_OUTBOUND_CALLS !== null &&
    config.ENABLE_OUTBOUND_CALLS !== ''
  ) {
    const flag = String(config.ENABLE_OUTBOUND_CALLS).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('ENABLE_OUTBOUND_CALLS must be "true" or "false"');
    }
  }

  // 13. OUTBOUND_CALLS_ENABLED (optional, boolean string 'true' or 'false')
  if (
    config.OUTBOUND_CALLS_ENABLED !== undefined &&
    config.OUTBOUND_CALLS_ENABLED !== null &&
    config.OUTBOUND_CALLS_ENABLED !== ''
  ) {
    const flag = String(config.OUTBOUND_CALLS_ENABLED).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('OUTBOUND_CALLS_ENABLED must be "true" or "false"');
    }
  }

  // 14. LIVEKIT_URL (optional, must be valid URL scheme if provided)
  if (config.LIVEKIT_URL !== undefined && config.LIVEKIT_URL !== null && config.LIVEKIT_URL !== '') {
    const lkUrl = String(config.LIVEKIT_URL).trim();
    if (
      !lkUrl.startsWith('wss://') &&
      !lkUrl.startsWith('ws://') &&
      !lkUrl.startsWith('https://') &&
      !lkUrl.startsWith('http://')
    ) {
      errors.push('LIVEKIT_URL must start with wss://, ws://, https://, or http://');
    }
  }

  // 15. SIP_OUTBOUND_CALLER_ID (optional, must be E.164 if provided)
  if (
    config.SIP_OUTBOUND_CALLER_ID !== undefined &&
    config.SIP_OUTBOUND_CALLER_ID !== null &&
    config.SIP_OUTBOUND_CALLER_ID !== ''
  ) {
    const callerId = String(config.SIP_OUTBOUND_CALLER_ID).trim();
    if (!callerId.startsWith('+') || callerId.length < 8) {
      errors.push('SIP_OUTBOUND_CALLER_ID must be a valid E.164 phone number starting with +');
    }
  }

  // 16. ALLOW_DEV_MOCK_AUTH (optional, boolean string 'true' or 'false'; ignored/forbidden in production)
  if (
    config.ALLOW_DEV_MOCK_AUTH !== undefined &&
    config.ALLOW_DEV_MOCK_AUTH !== null &&
    config.ALLOW_DEV_MOCK_AUTH !== ''
  ) {
    const flag = String(config.ALLOW_DEV_MOCK_AUTH).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('ALLOW_DEV_MOCK_AUTH must be "true" or "false"');
    }
  }

  // 17. ALLOW_DEV_LIVEKIT_SIMULATION (optional, boolean string 'true' or 'false'; ignored/forbidden in production)
  if (
    config.ALLOW_DEV_LIVEKIT_SIMULATION !== undefined &&
    config.ALLOW_DEV_LIVEKIT_SIMULATION !== null &&
    config.ALLOW_DEV_LIVEKIT_SIMULATION !== ''
  ) {
    const flag = String(config.ALLOW_DEV_LIVEKIT_SIMULATION).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('ALLOW_DEV_LIVEKIT_SIMULATION must be "true" or "false"');
    }
  }

  // 18. PAYMENT_SIMULATION_MODE & Razorpay Test Mode Configuration Safety
  const nodeEnv = String(config.NODE_ENV || '').trim().toLowerCase();
  const isProd = nodeEnv === 'production';
  const isPlaceholderVal = (val: unknown) => {
    if (typeof val !== 'string') return true;
    const t = val.trim().toLowerCase();
    return (
      !t ||
      t.includes('placeholder') ||
      t.startsWith('your_') ||
      t.includes('mock') ||
      t.includes('test_dummy') ||
      t === 'changeme'
    );
  };

  if (
    config.PAYMENT_SIMULATION_MODE !== undefined &&
    config.PAYMENT_SIMULATION_MODE !== null &&
    config.PAYMENT_SIMULATION_MODE !== ''
  ) {
    const flag = String(config.PAYMENT_SIMULATION_MODE).trim().toLowerCase();
    if (flag !== 'true' && flag !== 'false') {
      errors.push('PAYMENT_SIMULATION_MODE must be "true" or "false"');
    } else if (isProd && flag === 'true') {
      errors.push('PAYMENT_SIMULATION_MODE cannot be "true" in production');
    }
  }

  if (
    config.RAZORPAY_KEY_ID !== undefined &&
    config.RAZORPAY_KEY_ID !== null &&
    String(config.RAZORPAY_KEY_ID).trim() !== '' &&
    !isPlaceholderVal(config.RAZORPAY_KEY_ID)
  ) {
    const rzpKeyId = String(config.RAZORPAY_KEY_ID).trim();
    if (!rzpKeyId.startsWith('rzp_test_') && !rzpKeyId.startsWith('rzp_live_')) {
      errors.push('RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_');
    } else if (!isProd && rzpKeyId.startsWith('rzp_live_')) {
      errors.push('RAZORPAY_KEY_ID cannot use Live Mode credentials (rzp_live_*) outside production');
    }

    if (isPlaceholderVal(config.RAZORPAY_KEY_SECRET)) {
      errors.push('RAZORPAY_KEY_SECRET is required when RAZORPAY_KEY_ID is configured');
    }
    if (isProd && isPlaceholderVal(config.RAZORPAY_WEBHOOK_SECRET)) {
      errors.push('RAZORPAY_WEBHOOK_SECRET is required in production when Razorpay is configured');
    }
  }

  // 19. INTEGRATION_ENCRYPTION_KEY (required in production; validated for 32-byte key length whenever provided)
  const rawEncKey = config.INTEGRATION_ENCRYPTION_KEY;
  if (rawEncKey !== undefined && rawEncKey !== null && String(rawEncKey).trim() !== '') {
    try {
      parseIntegrationEncryptionKey(String(rawEncKey));
    } catch {
      errors.push(
        'INTEGRATION_ENCRYPTION_KEY must be a valid 32-byte (256-bit) hex or base64 key',
      );
    }
  } else if (isProd) {
    errors.push('INTEGRATION_ENCRYPTION_KEY is required in production to protect stored credentials');
  }

  if (errors.length > 0) {
    const formattedErrors = errors.map((err) => `  - ${err}`).join('\n');
    throw new Error(
      `\n❌ [EnvironmentValidationError] Invalid application configuration:\n${formattedErrors}\n\nPlease check your .env file or deployment environment variables.\n`,
    );
  }

  return config as ValidatedEnvironment;
}
