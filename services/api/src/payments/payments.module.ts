import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [PrismaModule, AuditLogsModule, IntegrationsModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
