import { describe, it, expect } from 'vitest';
import { SipRequestBuilder } from './sip-request.builder.js';

describe('SipRequestBuilder - Pure SIP Request Validation (No Network I/O)', () => {
  describe('Indian Mobile Number Validation', () => {
    it('validates and normalizes valid Indian mobile numbers in various input formats', () => {
      const inputs = [
        '+919876543210',
        '+91 98765 43210',
        '+91-98765-43210',
        '9876543210',
        '09876543210',
        '919876543210',
        '+916123456789', // starts with 6
        '+917123456789', // starts with 7
        '+918123456789', // starts with 8
      ];

      for (const input of inputs) {
        const result = SipRequestBuilder.validateIndianMobileNumber(input);
        expect(result.isValid).toBe(true);
        expect(result.value).toMatch(/^\+91[6-9]\d{9}$/);
      }
    });

    it('rejects numbers that start with invalid initial digits (0-5)', () => {
      const invalidInitials = [
        '+915876543210',
        '+914876543210',
        '+913876543210',
        '+912876543210',
        '+911876543210',
        '+910876543210',
      ];

      for (const input of invalidInitials) {
        const result = SipRequestBuilder.validateIndianMobileNumber(input);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });

    it('explicitly rejects Indian landline and STD code numbers', () => {
      const landlines = [
        '01123456789', // Delhi
        '02223456789', // Mumbai
        '08023456789', // Bengaluru
        '+911123456789',
        '+912223456789',
      ];

      for (const input of landlines) {
        const result = SipRequestBuilder.validateIndianMobileNumber(input);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('landline or STD');
      }
    });

    it('rejects malformed numbers, wrong lengths, and empty strings', () => {
      const malformed = [
        '',
        '   ',
        null as any,
        undefined as any,
        '12345',
        '+91987654321', // 9 digits
        '+9198765432100', // 11 digits
        '+15105550100', // US number
        'not_a_number',
        '+91-987-ABCD-12',
      ];

      for (const input of malformed) {
        const result = SipRequestBuilder.validateIndianMobileNumber(input);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('Caller ID Validation', () => {
    it('accepts valid E.164 caller IDs', () => {
      const valid = ['+918012345678', '+912298765432', '+15105550100', '+91 80 1234 5678'];
      for (const cid of valid) {
        const result = SipRequestBuilder.validateCallerId(cid);
        expect(result.isValid).toBe(true);
        expect(result.value).toMatch(/^\+[1-9]\d{7,14}$/);
      }
    });

    it('rejects empty, missing, or malformed caller IDs without E.164 + prefix', () => {
      const invalid = ['', '  ', null as any, undefined as any, '8012345678', '08012345678', 'invalid_cli'];
      for (const cid of invalid) {
        const result = SipRequestBuilder.validateCallerId(cid);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('LiveKit Outbound Trunk ID Validation', () => {
    it('accepts valid trunk identifiers', () => {
      const valid = ['ST_carrier_outbound_1', 'ST_exotel_mumbai_01', 'ST_12345'];
      for (const trunkId of valid) {
        const result = SipRequestBuilder.validateTrunkId(trunkId);
        expect(result.isValid).toBe(true);
        expect(result.value).toBe(trunkId);
      }
    });

    it('rejects empty or excessively short trunk IDs', () => {
      const invalid = ['', '   ', null as any, undefined as any, 'ST'];
      for (const trunkId of invalid) {
        const result = SipRequestBuilder.validateTrunkId(trunkId);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('Complete SipRequestBuilder.build() Workflow', () => {
    it('builds a complete SipCallRequest object when all fields are valid', () => {
      const result = SipRequestBuilder.build({
        to: '+91 98765 43210',
        callerId: '+918012345678',
        trunkId: 'ST_exotel_mumbai_01',
        customerId: 'cust_mehta_traders',
        customerName: 'Mehta Traders',
        callReason: 'Invoice Follow-up',
      });

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
      expect(result.request).toBeDefined();

      const req = result.request!;
      expect(req.destination).toBe('+919876543210');
      expect(req.callerId).toBe('+918012345678');
      expect(req.trunkId).toBe('ST_exotel_mumbai_01');
      expect(req.roomName).toMatch(/^mcf-cust_mehta_traders-[a-z0-9]+$/);
      expect(req.participantIdentity).toMatch(/^sip-919876543210-[a-z0-9]+$/);
      expect(req.participantName).toBe('PSTN: Mehta Traders');
      expect(req.waitUntilAnswered).toBe(true);
      expect(req.ringingTimeoutSeconds).toBe(45);
    });

    it('collects all validation errors without leaking sensitive data when inputs are missing', () => {
      const result = SipRequestBuilder.build({
        to: 'invalid_destination',
        callerId: '',
        trunkId: '',
      });

      expect(result.success).toBe(false);
      expect(result.request).toBeUndefined();
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBe(3);
      expect(result.errors![0]).toContain('Unsupported phone format');
      expect(result.errors![1]).toContain('Caller ID');
      expect(result.errors![2]).toContain('Trunk ID');
    });
  });
});
