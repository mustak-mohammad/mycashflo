import { describe, it, expect } from 'vitest';
import { validateEnvironment } from './env.validation.js';

describe('validateEnvironment - Startup Environment Validation', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://postgres:secretpassword@localhost:5432/mycashflo?schema=public',
    JWT_ACCESS_SECRET: 'super_secret_access_token_key_123456',
    JWT_REFRESH_SECRET: 'super_secret_refresh_token_key_123456',
    PORT: '3000',
    WEB_ORIGIN: 'http://localhost:5173',
  };

  it('should pass with fully valid environment configuration', () => {
    const validated = validateEnvironment(validConfig);
    expect(validated.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(validated.JWT_ACCESS_SECRET).toBe(validConfig.JWT_ACCESS_SECRET);
    expect(validated.JWT_REFRESH_SECRET).toBe(validConfig.JWT_REFRESH_SECRET);
  });

  it('should fail when DATABASE_URL is missing', () => {
    const invalidConfig = { ...validConfig, DATABASE_URL: '' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'DATABASE_URL is required (must be a valid PostgreSQL connection string)',
    );
  });

  it('should fail when DATABASE_URL has invalid protocol', () => {
    const invalidConfig = { ...validConfig, DATABASE_URL: 'mysql://root:pwd@localhost/db' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'DATABASE_URL must be a valid PostgreSQL connection URI',
    );
  });

  it('should fail when JWT_ACCESS_SECRET is missing or too short', () => {
    const invalidConfig = { ...validConfig, JWT_ACCESS_SECRET: 'short' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'JWT_ACCESS_SECRET must be at least 16 characters for cryptographic safety',
    );
  });

  it('should fail when JWT_REFRESH_SECRET is missing', () => {
    const invalidConfig = { ...validConfig, JWT_REFRESH_SECRET: undefined };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'JWT_REFRESH_SECRET is required',
    );
  });

  it('should fail when PORT is not a valid number', () => {
    const invalidConfig = { ...validConfig, PORT: 'abc' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'PORT must be a valid integer between 1 and 65535',
    );
  });

  it('should validate valid email configuration', () => {
    const configWithEmail = {
      ...validConfig,
      RESEND_API_KEY: 're_1234567890abcdef',
      EMAIL_FROM: 'myCashflo <billing@mycashflo.in>',
      EMAIL_TEST_RECIPIENT: 'test@mycashflo.internal',
      EMAIL_DELIVERY_ENABLED: 'true',
    };
    const validated = validateEnvironment(configWithEmail);
    expect(validated.RESEND_API_KEY).toBe('re_1234567890abcdef');
    expect(validated.EMAIL_FROM).toBe('myCashflo <billing@mycashflo.in>');
  });

  it('should fail when RESEND_API_KEY format is invalid', () => {
    const invalidConfig = { ...validConfig, RESEND_API_KEY: 'invalid_key_format' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'RESEND_API_KEY must be a valid Resend API key starting with re_',
    );
  });

  it('should fail when EMAIL_FROM does not contain @', () => {
    const invalidConfig = { ...validConfig, EMAIL_FROM: 'Invalid From Address' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'EMAIL_FROM must be a valid email address',
    );
  });

  it('should fail when EMAIL_TEST_RECIPIENT does not contain @', () => {
    const invalidConfig = { ...validConfig, EMAIL_TEST_RECIPIENT: 'invalid_test_recipient' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'EMAIL_TEST_RECIPIENT must be a valid email address',
    );
  });

  it('should NEVER leak secret values in the error message', () => {
    const configWithSecrets = {
      DATABASE_URL: 'mysql://root:SUPER_SECRET_DB_PASSWORD@localhost/db',
      JWT_ACCESS_SECRET: 'short_secret',
      JWT_REFRESH_SECRET: '',
      RESEND_API_KEY: 'not_a_valid_prefix_SUPER_SECRET_RESEND_KEY',
    };
    try {
      validateEnvironment(configWithSecrets);
      expect.fail('Should have thrown EnvironmentValidationError');
    } catch (err: any) {
      expect(err.message).not.toContain('SUPER_SECRET_DB_PASSWORD');
      expect(err.message).not.toContain('short_secret');
      expect(err.message).not.toContain('SUPER_SECRET_RESEND_KEY');
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).toContain('JWT_ACCESS_SECRET');
      expect(err.message).toContain('JWT_REFRESH_SECRET');
      expect(err.message).toContain('RESEND_API_KEY');
    }
  });

  it('should accept valid AUTOMATED_REMINDERS_ENABLED flag', () => {
    const configTrue = { ...validConfig, AUTOMATED_REMINDERS_ENABLED: 'true' };
    const configFalse = { ...validConfig, AUTOMATED_REMINDERS_ENABLED: 'false' };
    expect(validateEnvironment(configTrue).AUTOMATED_REMINDERS_ENABLED).toBe('true');
    expect(validateEnvironment(configFalse).AUTOMATED_REMINDERS_ENABLED).toBe('false');
  });

  it('should fail when AUTOMATED_REMINDERS_ENABLED is not boolean string', () => {
    const invalidConfig = { ...validConfig, AUTOMATED_REMINDERS_ENABLED: 'yes' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'AUTOMATED_REMINDERS_ENABLED must be "true" or "false"',
    );
  });

  it('should accept valid REMINDERS_TEST_MODE flag', () => {
    const configTrue = { ...validConfig, REMINDERS_TEST_MODE: 'true' };
    const configFalse = { ...validConfig, REMINDERS_TEST_MODE: 'false' };
    expect(validateEnvironment(configTrue).REMINDERS_TEST_MODE).toBe('true');
    expect(validateEnvironment(configFalse).REMINDERS_TEST_MODE).toBe('false');
  });

  it('should fail when REMINDERS_TEST_MODE is not boolean string', () => {
    const invalidConfig = { ...validConfig, REMINDERS_TEST_MODE: 'invalid' };
    expect(() => validateEnvironment(invalidConfig)).toThrow(
      'REMINDERS_TEST_MODE must be "true" or "false"',
    );
  });

  it('should validate WHATSAPP_TEST_RECIPIENT format', () => {
    const configValid = { ...validConfig, WHATSAPP_TEST_RECIPIENT: '919618954429' };
    expect(validateEnvironment(configValid).WHATSAPP_TEST_RECIPIENT).toBe('919618954429');

    const configInvalid = { ...validConfig, WHATSAPP_TEST_RECIPIENT: '123' };
    expect(() => validateEnvironment(configInvalid)).toThrow(
      'WHATSAPP_TEST_RECIPIENT must be a valid phone number (at least 8 digits)',
    );
  });

  it('should validate LIVEKIT_URL scheme', () => {
    const configValid = { ...validConfig, LIVEKIT_URL: 'wss://my-project.livekit.cloud' };
    expect(validateEnvironment(configValid).LIVEKIT_URL).toBe('wss://my-project.livekit.cloud');

    const configInvalid = { ...validConfig, LIVEKIT_URL: 'ftp://my-project.livekit.cloud' };
    expect(() => validateEnvironment(configInvalid)).toThrow(
      'LIVEKIT_URL must start with wss://, ws://, https://, or http://',
    );
  });

  it('should validate SIP_OUTBOUND_CALLER_ID format', () => {
    const configValid = { ...validConfig, SIP_OUTBOUND_CALLER_ID: '+919876543210' };
    expect(validateEnvironment(configValid).SIP_OUTBOUND_CALLER_ID).toBe('+919876543210');

    const configInvalid = { ...validConfig, SIP_OUTBOUND_CALLER_ID: '9876543210' };
    expect(() => validateEnvironment(configInvalid)).toThrow(
      'SIP_OUTBOUND_CALLER_ID must be a valid E.164 phone number starting with +',
    );
  });
});
