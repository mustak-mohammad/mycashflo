import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}

