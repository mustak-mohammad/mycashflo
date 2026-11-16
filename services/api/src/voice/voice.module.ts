import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { DocumentDeliveryService } from './document-delivery.service.js';
import { RecorderModule } from './recorder.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [
    PrismaModule,
    RecorderModule,
    PaymentsModule,
    IntegrationsModule,
    AuditLogsModule,
    InvoicesModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, DocumentDeliveryService],
  exports: [VoiceService, DocumentDeliveryService],
})
export class VoiceModule {}
