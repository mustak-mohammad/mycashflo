import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('ageing')
  @ApiOperation({ summary: 'Receivables ageing report (0-30, 31-60, 61-90, 90+ days)' })
  getAgeing(@CurrentUser() user: AuthUser) {
    return this.reportsService.getAgeing(user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'KPI summary — billed, collected, overdue, rates' })
  getSummary(@CurrentUser() user: AuthUser) {
    return this.reportsService.getSummary(user);
  }
}
