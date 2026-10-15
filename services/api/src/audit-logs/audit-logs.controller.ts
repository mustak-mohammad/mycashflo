import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { AuditLogsService, AuditLogQueryDto } from './audit-logs.service.js';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant-scoped audit logs with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated audit logs' })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findAll(user, query);
  }
}
