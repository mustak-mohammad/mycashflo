import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { WhatsAppInboundSafetyService } from './whatsapp-inbound-safety.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [AuditLogsModule, IntegrationsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    WhatsAppInboundSafetyService,
    NotificationOutboxService,
  ],
  exports: [
    NotificationsService,
    WhatsAppInboundSafetyService,
    NotificationOutboxService,
  ],
})
export class NotificationsModule {}

