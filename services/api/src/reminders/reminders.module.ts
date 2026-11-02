import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PromptsModule } from '../prompts/prompts.module.js';
import { RemindersService } from './reminders.service.js';
import { RemindersScheduler } from './reminders.scheduler.js';
import { RemindersController } from './reminders.controller.js';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    IntegrationsModule,
    PromptsModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersScheduler],
  exports: [RemindersService],
})
export class RemindersModule {}
