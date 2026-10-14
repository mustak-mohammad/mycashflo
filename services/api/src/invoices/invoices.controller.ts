import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { InvoicesService, CreateInvoiceDto, UpdateInvoiceDto } from './invoices.service.js';
import { InvoiceQueryDto } from '../common/dto/query.dto.js';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'List all invoices for the tenant' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: InvoiceQueryDto) {
    return this.invoicesService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new invoice' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice status or details' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user, dto);
  }
}
