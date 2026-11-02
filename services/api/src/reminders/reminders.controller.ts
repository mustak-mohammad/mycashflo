import { Controller, Get, Put, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { RemindersService } from './reminders.service.js';
import {
  UpdateReminderSettingsDto,
  SendTestReminderDto,
  TriggerRunDto,
} from './reminders.types.js';
import { NotifStatus, UserRole } from '@prisma/client';

@ApiTags('Reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get automated reminder settings and global status for the current tenant' })
  async getSettings(@CurrentUser() user: AuthUser) {
    return this.remindersService.getSettings(user.tenantId);
  }

  @Put('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update automated reminder settings for the current tenant' })
  async updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateReminderSettingsDto) {
    return this.remindersService.updateSettings(user.tenantId, dto, user.userId);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Preview upcoming reminders (dry-run evaluation without dispatch)' })
  async previewReminders(@CurrentUser() user: AuthUser) {
    return this.remindersService.previewReminders(user);
  }

  @Post('trigger')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Manually trigger automated reminders scan for current tenant' })
  async triggerRun(@CurrentUser() user: AuthUser, @Body() dto: TriggerRunDto) {
    return this.remindersService.triggerRun(user, dto?.dryRun);
  }

  @Post('test-send')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Dispatch a test reminder strictly to the configured test recipient' })
  async sendTestReminder(@CurrentUser() user: AuthUser, @Body() dto: SendTestReminderDto) {
    return this.remindersService.sendTestReminder(user, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get reminder statistics (sent, delivered, failed, suppressed, pending)' })
  async getStats(@CurrentUser() user: AuthUser) {
    return this.remindersService.getStats(user);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get paginated history of reminders and failure/suppression reasons' })
  async getHistory(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('status') status?: NotifStatus,
  ) {
    return this.remindersService.getHistory(user, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      invoiceId,
      status,
    });
  }
}
