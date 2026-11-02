import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  CallsService,
  CallQueryDto,
  CreateCallDto,
  InitiateOutboundCallDto,
} from './calls.service.js';
import type { Response } from 'express';

@ApiTags('calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all call sessions (paginated, filterable by outcome)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CallQueryDto) {
    return this.callsService.findAll(user, query);
  }

  @Get('export')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Export call sessions as CSV' })
  async exportCsv(@CurrentUser() user: AuthUser, @Res() res: Response, @Query() query: CallQueryDto) {
    const csv = await this.callsService.exportCsv(user, query);
    const filename = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  @Get(':id/recording')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Resolve the call recording URL (polls egress; 404 if none)' })
  async getRecording(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.callsService.resolveRecording(id, user);
    if (result.status === 'NONE') {
      throw new NotFoundException('No recording is available for this call');
    }
    return result;
  }

  @Post(':id/recording/upload')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload an audio recording blob for a call session' })
  async uploadRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { audioBase64?: string; mimeType?: string },
    @Req() req: any,
  ) {
    let buffer: Buffer | null = null;
    let mimeType = body?.mimeType || 'audio/webm';

    if (body?.audioBase64) {
      buffer = Buffer.from(body.audioBase64, 'base64');
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      buffer = req.body;
      mimeType = req.headers['content-type'] || mimeType;
    } else if (req.readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        buffer = Buffer.concat(chunks);
        mimeType = req.headers['content-type'] || 'audio/webm';
      }
    }

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No audio data provided in request');
    }

    return this.callsService.saveRecording(id, user, buffer, mimeType);
  }

  @Get(':id/recording/stream')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Stream call audio with HTTP 206 Partial Content range support' })
  async streamRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const fileInfo = await this.callsService.getRecordingFilePath(id, user);
    if (!fileInfo) {
      const rec = await this.callsService.resolveRecording(id, user);
      if (rec.status === 'AVAILABLE' && rec.url && !rec.url.includes('/recording/stream')) {
        return res.redirect(rec.url);
      }
      throw new NotFoundException('No recording audio file found for this call');
    }

    const { filePath, mimeType } = fileInfo;
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      });

      return fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  @Get(':id/recording/download')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Download call audio file with attachment header' })
  async downloadRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const fileInfo = await this.callsService.getRecordingFilePath(id, user);
    if (!fileInfo) {
      const rec = await this.callsService.resolveRecording(id, user);
      if (rec.status === 'AVAILABLE' && rec.url && !rec.url.includes('/recording/stream')) {
        return res.redirect(rec.url);
      }
      throw new NotFoundException('No recording audio file available for download');
    }

    const { filePath, mimeType, call } = fileInfo;
    const stat = await fs.promises.stat(filePath);
    const custLabel = (call.customer?.name || 'call').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = path.extname(filePath) || '.webm';
    const filename = `recording-${custLabel}-${id.slice(0, 8)}${ext}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return fs.createReadStream(filePath).pipe(res);
  }


  @Get(':id/report')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get details of a specific call session' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.callsService.findOne(id, user);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record a completed or in-progress call session' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCallDto) {
    return this.callsService.create(user, dto);
  }

  @Post('outbound/initiate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Initiate an outbound collection call via SIP Telephony gateway (safe simulation by default)' })
  initiateOutboundCall(
    @CurrentUser() user: AuthUser,
    @Body() dto: InitiateOutboundCallDto,
  ) {
    return this.callsService.initiateOutboundCall(user, dto);
  }

  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telephony carrier status callback webhook' })
  handleTelephonyWebhook(
    @Param('provider') provider: string,
    @Body() payload: any,
  ) {
    return this.callsService.handleTelephonyWebhook(provider, payload);
  }
}

/**
 * Minimal zero-dependency PDF generator for Call Reports.
 * Follows the same binary-safe approach as buildInvoicePdf.
 */
function buildCallReportPdf(input: { tenantName: string; call: any }): Buffer {
  const { tenantName, call } = input;
  const customer = call.customer ?? {};
  const agentName = call.agent?.name ?? 'Chotu AI';

  const ascii = (val: any): string => {
    const str = val === null || val === undefined ? '' : String(val);
    return str
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  };

  const dateStr = (d: any) => (d ? new Date(d).toLocaleString('en-IN') : '-');

  const ops: string[] = [];
  const put = (x: number, y: number, font: 'F1' | 'F2', size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${ascii(str)}) Tj ET`);
  };

  // Header & Branding
  put(50, 800, 'F1', 22, 'CALL SESSION REPORT');
  put(50, 782, 'F2', 10, `Generated by ${tenantName} via myCashflo`);
  ops.push('0.85 0.85 0.85 RG 0.5 w 50 770 m 545 770 l S');

  // Metadata Section
  put(50, 745, 'F1', 11, 'Call Details');
  put(50, 730, 'F2', 10, `Customer: ${customer.name || 'Unknown'} (${customer.phone || 'No Phone'})`);
  put(50, 715, 'F2', 10, `Agent: ${agentName}`);
  put(50, 700, 'F2', 10, `Started At: ${dateStr(call.startedAt)}`);
  put(50, 685, 'F2', 10, `Duration: ${call.duration || 0} seconds`);
  put(50, 670, 'F2', 10, `Outcome: ${call.outcome || 'IN_PROGRESS'}`);

  // Summary Section
  put(50, 635, 'F1', 11, 'AI Summary');
  const summaryText = call.summary || 'No summary available for this session.';
  // Simple wrapping for summary (PDF lacks auto-wrap)
  const summaryLines = summaryText.match(/.{1,85}(\s|$)/g) || [summaryText];
  summaryLines.slice(0, 5).forEach((line: string, i: number) => {
    put(55, 620 - i * 14, 'F2', 10, line.trim());
  });

  // Transcript Section
  put(50, 530, 'F1', 11, 'Full Transcript');
  ops.push('0.90 0.90 0.90 RG 0.3 w 50 522 m 545 522 l S');
  
  const transcriptText = call.transcript || 'No transcript available.';
  const transcriptLines = transcriptText.split('\n').flatMap((l: string) => l.match(/.{1,90}(\s|$)/g) || [l]);
  transcriptLines.slice(0, 30).forEach((line: string, i: number) => {
    put(55, 505 - i * 12, 'F2', 9, line.trim());
  });

  // Footer
  put(50, 40, 'F2', 8, `Report ID: ${call.id} | myCashflo Intelligence`);

  const content = ops.join('\n');

  const objects: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    6: `<< /Length ${Buffer.byteLength(content, 'latin1')} >> stream\n${content}\nendstream`
  };

  let pdf = '%PDF-1.4\n';
  const offsets: Record<number, number> = {};
  for (const [id, val] of Object.entries(objects)) {
    offsets[Number(id)] = pdf.length;
    pdf += `${id} 0 obj\n${val}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

