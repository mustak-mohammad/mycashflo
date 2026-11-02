import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import type { NotificationsService } from './notifications.service.js';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let mockNotificationsService: any;

  beforeEach(() => {
    mockNotificationsService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      dispatch: vi.fn(),
      verifyWhatsAppWebhook: vi.fn(),
      handleWhatsAppWebhook: vi.fn(),
      handleEmailWebhook: vi.fn(),
    };

    controller = new NotificationsController(mockNotificationsService as unknown as NotificationsService);
  });

  describe('GET webhook/whatsapp (verifyWhatsAppWebhook)', () => {
    it('returns challenge with HTTP 200 when token and mode match', () => {
      const sampleChallenge = 'hub_challenge_sample_98765';
      mockNotificationsService.verifyWhatsAppWebhook.mockReturnValue(sampleChallenge);

      const result = controller.verifyWhatsAppWebhook(
        'subscribe',
        'valid_development_verify_token',
        sampleChallenge,
      );

      expect(mockNotificationsService.verifyWhatsAppWebhook).toHaveBeenCalledWith(
        'subscribe',
        'valid_development_verify_token',
        sampleChallenge,
      );
      expect(result).toBe(sampleChallenge);
    });

    it('rejects and throws BadRequestException when verify token does not match', () => {
      mockNotificationsService.verifyWhatsAppWebhook.mockImplementation(() => {
        throw new BadRequestException('Forbidden webhook verification token');
      });

      expect(() =>
        controller.verifyWhatsAppWebhook(
          'subscribe',
          'incorrect_token',
          'hub_challenge_sample_98765',
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects and throws BadRequestException when mode is not subscribe', () => {
      mockNotificationsService.verifyWhatsAppWebhook.mockImplementation(() => {
        throw new BadRequestException('Forbidden webhook verification token');
      });

      expect(() =>
        controller.verifyWhatsAppWebhook(
          'unsubscribe',
          'valid_development_verify_token',
          'hub_challenge_sample_98765',
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('POST webhook/whatsapp (handleWhatsAppWebhook)', () => {
    it('accepts status update and returns ok when signature is valid', async () => {
      const mockPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: 'wamid.HBgL123==', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      };
      mockNotificationsService.handleWhatsAppWebhook.mockResolvedValue({
        status: 'ok',
        processed: 1,
        updated: 1,
      });

      const res = await controller.handleWhatsAppWebhook(mockPayload, 'sha256=valid_test_signature');

      expect(mockNotificationsService.handleWhatsAppWebhook).toHaveBeenCalledWith(
        mockPayload,
        'sha256=valid_test_signature',
      );
      expect(res).toEqual({ status: 'ok', processed: 1, updated: 1 });
    });

    it('rejects with BadRequestException when signature validation fails', async () => {
      mockNotificationsService.handleWhatsAppWebhook.mockRejectedValue(
        new BadRequestException('Invalid WhatsApp webhook signature'),
      );

      await expect(
        controller.handleWhatsAppWebhook({}, 'sha256=forged_bad_signature'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
