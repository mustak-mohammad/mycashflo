import {
  Controller, Get, Post, Put, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from './customers.service.js';
import { CustomerQueryDto } from '../common/dto/query.dto.js';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers (paginated, searchable)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CustomerQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one customer with recent invoices and payments' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new customer' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.service.create(user, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, user, dto);
  }
}
