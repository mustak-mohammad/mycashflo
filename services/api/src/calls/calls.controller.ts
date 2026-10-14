import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CallsService, CallQueryDto, CreateCallDto } from './calls.service.js';

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
