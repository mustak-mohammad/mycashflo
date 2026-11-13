import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

export const INTEGRATION_SECRET_KEYS = [
  'keySecret',
  'secretKey',
  'authToken',
  'accessToken',
  'webhookSecret',
  'appSecret',
  'apiKey',
  'sipPassword',
] as const;

export const ENCRYPTION_VERSION_PREFIX = 'enc:v1:';

export interface SecretAadContext {
  tenantId: string;
  provider: string;
  field: string;
}

const SECRET_KEY_SET = new Set<string>(INTEGRATION_SECRET_KEYS);

export function isIntegrationSecretField(field: string): boolean {
  return SECRET_KEY_SET.has(field);
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_VERSION_PREFIX);
}

function isPlaceholderKeyMaterial(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return (
    !lower ||
    lower.includes('placeholder') ||
    lower.startsWith('your_') ||
    lower.includes('change_this') ||
    lower === 'changeme'
  );
}

/**
 * Parses and validates the 256-bit (32-byte) master key from INTEGRATION_ENCRYPTION_KEY.
 * Supports 64-char hex or base64 encoding (with optional `base64:` prefix).
 * Never exposes or logs key material on failure.
 */
export function parseIntegrationEncryptionKey(rawValue: unknown): Buffer {
  if (typeof rawValue !== 'string' || isPlaceholderKeyMaterial(rawValue)) {
    throw new InternalServerErrorException(
      'Integration encryption key (INTEGRATION_ENCRYPTION_KEY) is missing or not configured.',
    );
  }

  let candidate = rawValue.trim();
  if (candidate.startsWith('hex:')) {
    candidate = candidate.slice(4).trim();
  } else if (candidate.startsWith('base64:')) {
    candidate = candidate.slice(7).trim();
  }

  if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
    const buf = Buffer.from(candidate, 'hex');
    if (buf.length === 32) return buf;
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(candidate) && candidate.length >= 43) {
    const buf = Buffer.from(candidate, 'base64');
    if (buf.length === 32 && buf.toString('base64').replace(/=+$/, '') === candidate.replace(/=+$/, '')) {
      return buf;
    }
  }

  throw new InternalServerErrorException(
    'Integration encryption key (INTEGRATION_ENCRYPTION_KEY) is invalid; expected a 32-byte hex or base64 key.',
  );
}

export function resolveIntegrationEncryptionKey(): Buffer {
  return parseIntegrationEncryptionKey(process.env.INTEGRATION_ENCRYPTION_KEY);
}

function buildAad(context?: SecretAadContext): Buffer | undefined {
  if (!context) return undefined;
  return Buffer.from(
    `mycashflo:v1:${context.tenantId}:${context.provider.toUpperCase()}:${context.field}`,
    'utf8',
  );
}

/**
 * Encrypts a single secret value using AES-256-GCM and a fresh 96-bit IV.
 * Output format: `enc:v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>`.
 */
export function encryptIntegrationSecret(
  plaintext: string,
  context?: SecretAadContext,
): string {
  const key = resolveIntegrationEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const aad = buildAad(context);
  if (aad) {
    cipher.setAAD(aad);
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_VERSION_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Authenticates and decrypts an `enc:v1:` AES-256-GCM secret.
 * Fails closed cleanly on missing key, malformed envelope, or tag/AAD mismatch.
 */
export function decryptIntegrationSecret(
  encoded: string,
  context?: SecretAadContext,
): string {
  const key = resolveIntegrationEncryptionKey();
  if (!isEncryptedSecret(encoded)) {
    throw new InternalServerErrorException('Unsupported encrypted secret format.');
  }

  const body = encoded.slice(ENCRYPTION_VERSION_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new InternalServerErrorException('Malformed encrypted integration credential envelope.');
  }

  try {
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid cipher component lengths');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    const aad = buildAad(context);
    if (aad) {
      decipher.setAAD(aad);
    }
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    return plaintext;
  } catch {
    throw new InternalServerErrorException(
      'Failed to authenticate or decrypt stored integration credential.',
    );
  }
}

/**
 * Decrypts encrypted secret fields in an integration config JSON object while keeping
 * non-sensitive fields untouched and preserving backward compatibility for legacy plaintext records.
 */
export function decryptIntegrationConfig(
  rawConfig: Record<string, any> | null | undefined,
  context: { tenantId: string; provider: string },
): { config: Record<string, any>; hasLegacyPlaintextSecrets: boolean } {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const result: Record<string, any> = { ...source };
  let hasLegacyPlaintextSecrets = false;

  for (const field of INTEGRATION_SECRET_KEYS) {
    const val = result[field];
    if (typeof val !== 'string' || val.trim() === '') {
      continue;
    }
    if (isEncryptedSecret(val)) {
      result[field] = decryptIntegrationSecret(val, {
        tenantId: context.tenantId,
        provider: context.provider,
        field,
      });
    } else {
      hasLegacyPlaintextSecrets = true;
    }
  }

  return { config: result, hasLegacyPlaintextSecrets };
}
