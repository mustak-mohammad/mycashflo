import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  FollowUpsService,
  FollowUpQueryDto,
  CreateFollowUpDto,
  UpdateFollowUpDto,
} from './follow-ups.service.js';

@ApiTags('follow-ups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get()
  @ApiOperation({ summary: 'List follow-up tasks (paginated, filterable by done and priority)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: FollowUpQueryDto) {
    return this.followUpsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single follow-up task' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.followUpsService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new follow-up task' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFollowUpDto) {
    return this.followUpsService.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a follow-up task (mark done, reschedule, edit)' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateFollowUpDto,
  ) {
    return this.followUpsService.update(id, user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a follow-up task' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.followUpsService.remove(id, user);
  }
}
