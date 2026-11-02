import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

@Module({
  imports: [AuditLogsModule],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
