import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CallsService, CallQueryDto, CreateCallDto } from './calls.service.js';
import type { Response } from 'express';

@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @ApiOperation({ summary: 'List all call sessions (paginated, filterable by outcome)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CallQueryDto) {
    return this.callsService.findAll(user, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export call sessions as CSV' })
  async exportCsv(@CurrentUser() user: AuthUser, @Res() res: Response, @Query() query: CallQueryDto) {
    const csv = await this.callsService.exportCsv(user, query);
    const filename = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  @Get(':id/recording')
  @ApiOperation({ summary: 'Resolve the call recording URL (polls egress; 404 if none)' })
  async getRecording(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.callsService.resolveRecording(id, user);
    if (result.status === 'NONE') {
      throw new NotFoundException('No recording is available for this call');
    }
    return result;
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Download a detailed call report (PDF) with transcript and summary' })
  async downloadReport(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { call, tenantName } = await this.callsService.getCallForReport(id, user);
    const pdf = buildCallReportPdf({ tenantName, call });
    const timestamp = new Date(call.startedAt).toISOString().slice(0, 10);
    const filename = `call-report-${timestamp}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific call session' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.callsService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Record a completed or in-progress call session' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCallDto) {
    return this.callsService.create(user, dto);
  }
}
