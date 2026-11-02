import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { InvoicesService, CreateInvoiceDto, UpdateInvoiceDto } from './invoices.service.js';
import { InvoiceQueryDto } from '../common/dto/query.dto.js';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'List invoices for the tenant (scoped to assigned customers for Agents)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: InvoiceQueryDto) {
    return this.invoicesService.findAll(user, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export invoices as CSV' })
  async exportCsv(@CurrentUser() user: AuthUser, @Res() res: Response, @Query() query: InvoiceQueryDto) {
    const csv = await this.invoicesService.exportCsv(user, query);
    const filename = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download a single invoice as a PDF document' })
  async downloadPdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { invoice, tenantName } = await this.invoicesService.getInvoiceForPdf(id, user);
    const pdf = buildInvoicePdf({ tenantName, invoice });
    const safeNumber = invoice.number.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${safeNumber}.pdf"`);
    res.send(pdf);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID (assigned only for Agents)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new invoice (Admin/Manager only)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update invoice status or details (Admin/Manager only)' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user, dto);
  }
}

/**
 * Minimal zero-dependency PDF generator (PDF 1.4, base-14 Helvetica fonts).
 * Mirrors the hand-rolled binary approach used for the prompts ZIP export.
 */
function buildInvoicePdf(input: { tenantName: string; invoice: any }): Buffer {
  const { tenantName, invoice } = input;
  const customer = invoice.customer ?? {};

  const ascii = (val: any): string => {
    const str = val === null || val === undefined ? '' : String(val);
    // Keep to winansi-safe printable ASCII; escape PDF string delimiters.
    return str
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  };

  const money = (n: any) =>
    `INR ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(n) || 0)}`;

  const dateStr = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

  const ops: string[] = [];
  const put = (x: number, y: number, font: 'F1' | 'F2', size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${ascii(str)}) Tj ET`);
  };

  // Header
  put(50, 800, 'F1', 24, 'INVOICE');
  put(400, 800, 'F2', 11, `#${invoice.number}`);
  put(50, 782, 'F2', 11, tenantName);
  put(400, 782, 'F2', 11, `Status: ${invoice.status}`);
  ops.push('0.80 0.80 0.80 RG 0.7 w 50 770 m 545 770 l S');

  // Bill To
  put(50, 748, 'F1', 11, 'Bill To');
  put(50, 730, 'F2', 11, customer.name ?? '-');
  let leftY = 715;
  if (customer.company) {
    put(50, leftY, 'F2', 10, customer.company);
    leftY -= 15;
  }
  if (customer.email) {
    put(50, leftY, 'F2', 10, customer.email);
    leftY -= 15;
  }
  if (customer.phone) {
    put(50, leftY, 'F2', 10, customer.phone);
    leftY -= 15;
  }
  if (customer.gstNumber) {
    put(50, leftY, 'F2', 10, `GST: ${customer.gstNumber}`);
    leftY -= 15;
  }
  if (customer.billingAddress) {
    put(50, leftY, 'F2', 10, customer.billingAddress);
  }

  // Invoice Details
  put(360, 748, 'F1', 11, 'Invoice Details');
  put(360, 730, 'F2', 10, `Issue Date: ${dateStr(invoice.issueDate)}`);
  put(360, 715, 'F2', 10, `Due Date: ${dateStr(invoice.dueDate)}`);
  put(360, 700, 'F2', 10, `Currency: ${invoice.currency}`);

  // Line items table
  const tableTop = 650;
  ops.push(`0.93 0.95 0.98 rg 50 ${tableTop - 20} 495 22 re f 0 0 0 rg`);
  put(58, tableTop - 14, 'F1', 10, 'Description');
  put(430, tableTop - 14, 'F1', 10, 'Amount');

  const description = invoice.description || 'Goods / services rendered';
  put(58, tableTop - 42, 'F2', 10, description);
  put(430, tableTop - 42, 'F2', 10, money(invoice.amount));

  // Totals
  put(360, tableTop - 78, 'F2', 10, `Total Amount: ${money(invoice.amount)}`);
  put(360, tableTop - 96, 'F1', 11, `Outstanding: ${money(invoice.outstanding)}`);

  // Footer
  put(50, 60, 'F2', 9, `Generated by myCashflo on ${new Date().toISOString().slice(0, 10)}`);

  const content = ops.join('\n');

  const objects: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    6: `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  };

  let pdf = '%PDF-1.4\r\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\r\n${objects[i]}\r\nendobj\r\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\r\n0 7\r\n0000000000 65535 f \r\n';
  for (let i = 1; i <= 6; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \r\n`;
  }
  pdf += `trailer\r\n<< /Size 7 /Root 1 0 R >>\r\nstartxref\r\n${xrefOffset}\r\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
