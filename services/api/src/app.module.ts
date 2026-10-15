import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { FollowUpsModule } from './follow-ups/follow-ups.module.js';
import { CallsModule } from './calls/calls.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { IntelligenceModule } from './intelligence/intelligence.module.js';
import { PromptsModule } from './prompts/prompts.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    AuthModule,
    CustomersModule,
    InvoicesModule,
    CollectionsModule,
    PaymentsModule,
    ReportsModule,
    FollowUpsModule,
    CallsModule,
    VoiceModule,
    AuditLogsModule,
    NotificationsModule,
    IntelligenceModule,
    PromptsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

