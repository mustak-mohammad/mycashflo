import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { RecorderModule } from '../voice/recorder.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [RecorderModule, AuditLogsModule, IntegrationsModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
