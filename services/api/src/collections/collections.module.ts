import { Module } from '@nestjs/common';
import { CollectionsService } from './collections.service.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsOrchestrator } from './collections.orchestrator.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

@Module({
  imports: [NotificationsModule, AuditLogsModule],
  providers: [CollectionsService, CollectionsOrchestrator],
  controllers: [CollectionsController],
  exports: [CollectionsService, CollectionsOrchestrator],
})
export class CollectionsModule {}
