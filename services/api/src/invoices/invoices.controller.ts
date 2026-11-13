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
import { buildInvoicePdf } from './invoice-pdf.util.js';
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
