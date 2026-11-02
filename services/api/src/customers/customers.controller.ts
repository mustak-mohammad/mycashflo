import {
  Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { CustomersService, CreateCustomerDto, UpdateCustomerDto } from './customers.service.js';
import { CustomerQueryDto } from '../common/dto/query.dto.js';
import { UserRole } from '@prisma/client';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers (paginated, searchable, scoped to assigned for Agents)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CustomerQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one customer with recent invoices and payments (assigned only for Agents)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new customer (Admin/Manager only)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.service.create(user, dto);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a customer via PUT (Admin/Manager only)' })
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a customer via PATCH (Admin/Manager only)' })
  patch(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, user, dto);
  }
}
