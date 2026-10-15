import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ReportsService } from './reports.service.js';
import type { LedgerResult } from './reports.service.js';
import type { Response } from 'express';

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

  @Get('ledger')
  @ApiOperation({ summary: 'Customer ledger with chronological entries and running balance' })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  getLedger(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<LedgerResult> {
    return this.reportsService.getLedger(user, { customerId, startDate, endDate });
  }

  @Get('ledger/export')
  @ApiOperation({ summary: 'Export customer ledger as CSV or Excel Spreadsheet' })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  async exportLedger(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('customerId') customerId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format: string = 'csv',
  ) {
    const isExcel = format.toLowerCase() === 'xlsx' || format.toLowerCase() === 'xls';
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `customer-ledger-${dateStr}.${isExcel ? 'xls' : 'csv'}`;

    if (isExcel) {
      const xml = await this.reportsService.exportLedgerExcelXml(user, { customerId, startDate, endDate });
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(xml);
    } else {
      const csv = await this.reportsService.exportLedgerCsv(user, { customerId, startDate, endDate });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }
  }
}

