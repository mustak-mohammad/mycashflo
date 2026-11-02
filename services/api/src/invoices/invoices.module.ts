import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

@Module({
  imports: [AuditLogsModule],
  providers: [InvoicesService],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
