/**
 * Pure SIP Request Builder & Indian Telephony Validator
 *
 * Builds and validates LiveKit SIP outbound call request payloads without network I/O.
 * Enforces strict Indian E.164 mobile number rules (+91[6-9]xxxxxxxxx).
 * Validates trunk identifiers and caller IDs without inventing dummy defaults.
 */

export interface SipCallRequest {
  destination: string;         // E.164 normalized e.g. '+919876543210'
  callerId: string;            // E.164 verified provider caller ID
  trunkId: string;             // Stored LiveKit Outbound Trunk ID (e.g. 'ST_xxx')
  roomName: string;            // LiveKit room to bridge
  participantIdentity: string; // Unique participant identity
  participantName?: string;    // Human-readable participant label
  customerName?: string;
  callReason?: string;
  metadata?: Record<string, unknown>;
  waitUntilAnswered?: boolean;
  ringingTimeoutSeconds?: number;
}

export interface SipRequestBuilderOptions {
  to: string;
  callerId?: string;
  trunkId?: string;
  customerId?: string;
  customerName?: string;
  callReason?: string;
  roomPrefix?: string;
  timeoutSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult<T> {
  isValid: boolean;
  value?: T;
  error?: string;
}

export class SipRequestBuilder {
  /**
   * Validates Indian mobile destinations.
   * Mobile numbers in India must be 10 digits starting with 6, 7, 8, or 9.
   * E.164 prefix +91 is strictly validated and normalized.
   * Landlines and foreign numbers are explicitly rejected until separately supported.
   */
  static validateIndianMobileNumber(phone: string | undefined | null): ValidationResult<string> {
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
      return {
        isValid: false,
        error: 'Destination phone number is required and cannot be empty.',
      };
    }

    // Clean whitespace, dashes, dots, and parentheses
    const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');

    // Check for landline prefixes:
    // 1. Initial digit 1-5 (no Indian mobile starts with 1-5)
    // 2. Known Indian STD codes (011, 022, 033, 044, 040, 080, 020, 079) followed by local landline digits
    const isLandline =
      /^(\+91|0)?[1-5]/.test(cleaned) ||
      /^(\+91|0)?(11|22|33|44|40|80|20|79)[2-5]\d{6,7}$/.test(cleaned);

    if (isLandline) {
      return {
        isValid: false,
        error:
          'Destination is an Indian landline or STD number. Only Indian mobile numbers (+91 [6-9]xxxxxxxxx) are currently supported.',
      };
    }

    let digits = '';
    if (cleaned.startsWith('+91')) {
      digits = cleaned.slice(3);
    } else if (cleaned.startsWith('91') && cleaned.length === 12) {
      digits = cleaned.slice(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
      digits = cleaned.slice(1);
    } else if (cleaned.length === 10) {
      digits = cleaned;
    } else {
      return {
        isValid: false,
        error: `Unsupported phone format. Expected Indian E.164 mobile number (+91 followed by 10 digits), got: ${cleaned.slice(0, 4)}...`,
      };
    }

    // Verify exactly 10 digits starting with 6, 7, 8, or 9
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        error:
          'Invalid Indian mobile number. The 10-digit subscriber number must start with 6, 7, 8, or 9.',
      };
    }

    return {
      isValid: true,
      value: `+91${digits}`,
    };
  }

  /**
   * Validates provider-approved Caller ID (fromNumber / outboundCallerId).
   * Caller ID must be a valid E.164 number (8-15 digits prefixed with +).
   */
  static validateCallerId(callerId: string | undefined | null): ValidationResult<string> {
    if (!callerId || typeof callerId !== 'string' || callerId.trim() === '') {
      return {
        isValid: false,
        error: 'Caller ID (outboundCallerId / fromNumber) is required and cannot be empty.',
      };
    }

    const cleaned = callerId.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
      return {
        isValid: false,
        error:
          'Invalid Caller ID format. Caller ID must be in valid international E.164 format (+[country_code][subscriber_number]).',
      };
    }

    return {
      isValid: true,
      value: cleaned,
    };
  }

  /**
   * Validates LiveKit Outbound Trunk ID.
   * Trunk ID must be a non-empty string provided by the carrier/LiveKit (e.g. 'ST_xxx').
   * Never invents or fabricates trunk IDs.
   */
  static validateTrunkId(trunkId: string | undefined | null): ValidationResult<string> {
    if (!trunkId || typeof trunkId !== 'string' || trunkId.trim() === '') {
      return {
        isValid: false,
        error: 'LiveKit Outbound Trunk ID (sipTrunkId) is required and cannot be empty.',
      };
    }

    const trimmed = trunkId.trim();
    if (trimmed.length < 4) {
      return {
        isValid: false,
        error: 'LiveKit Outbound Trunk ID must be a valid non-empty identifier.',
      };
    }

    return {
      isValid: true,
      value: trimmed,
    };
  }

  /**
   * Builds and validates a pure SIP outbound call request object without network I/O.
   * Collects all validation errors without exposing secret credentials.
   */
  static build(options: SipRequestBuilderOptions): {
    success: boolean;
    request?: SipCallRequest;
    errors?: string[];
  } {
    const errors: string[] = [];

    // 1. Destination validation
    const destResult = this.validateIndianMobileNumber(options.to);
    if (!destResult.isValid) {
      errors.push(destResult.error!);
    }

    // 2. Caller ID validation
    const callerResult = this.validateCallerId(options.callerId);
    if (!callerResult.isValid) {
      errors.push(callerResult.error!);
    }

    // 3. Trunk ID validation
    const trunkResult = this.validateTrunkId(options.trunkId);
    if (!trunkResult.isValid) {
      errors.push(trunkResult.error!);
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    const destination = destResult.value!;
    const callerId = callerResult.value!;
    const trunkId = trunkResult.value!;

    const timestamp = Date.now().toString(36);
    const roomPrefix = options.roomPrefix || 'mcf';
    const customerSlug = (options.customerId || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
    const roomName = `${roomPrefix}-${customerSlug}-${timestamp}`;
    const participantIdentity = `sip-${destination.replace(/[^\d]/g, '')}-${timestamp}`;

    return {
      success: true,
      request: {
        destination,
        callerId,
        trunkId,
        roomName,
        participantIdentity,
        participantName: options.customerName ? `PSTN: ${options.customerName}` : `PSTN: ${destination}`,
        callReason: options.callReason,
        metadata: options.metadata,
        waitUntilAnswered: true,
        ringingTimeoutSeconds: options.timeoutSeconds || 45,
      },
    };
  }

  /**
   * Masks sensitive fields in configuration objects to prevent credential leakage in logs or responses.
   */
  static maskConfig(config: Record<string, any> | undefined | null): Record<string, any> {
    if (!config || typeof config !== 'object') return {};
    const sensitiveKeys = [
      'password',
      'sippassword',
      'token',
      'authtoken',
      'secret',
      'apisecret',
      'apikey',
      'privatekey',
      'credential',
    ];
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(config)) {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some((s) => lower.includes(s))) {
        masked[key] = value ? '***MASKED***' : value;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        masked[key] = this.maskConfig(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
}
