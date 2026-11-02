import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { WhatsAppInboundSafetyService } from './whatsapp-inbound-safety.service.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [AuditLogsModule, IntegrationsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, WhatsAppInboundSafetyService],
  exports: [NotificationsService, WhatsAppInboundSafetyService],
})
export class NotificationsModule {}

