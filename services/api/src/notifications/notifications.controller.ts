import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  NotificationsService,
  DispatchNotificationDto,
  NotificationQueryDto,
} from './notifications.service.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('templates')
  @ApiOperation({ summary: 'Get available notification templates with variable specs' })
  getTemplates() {
    return this.notificationsService.getTemplates();
  }

  @Get()
  @ApiOperation({ summary: 'List tenant-scoped notifications with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated notifications list' })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notificationsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single notification' })
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationsService.findOne(id, user);
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Dispatch a multi-channel notification (WhatsApp, SMS, Email)' })
  @ApiResponse({ status: 201, description: 'Notification dispatched' })
  async dispatch(@CurrentUser() user: AuthUser, @Body() dto: DispatchNotificationDto) {
    return this.notificationsService.dispatch(user, dto);
  }

  @Post('trigger-reminders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Automatically evaluate overdue invoices and dispatch multi-channel reminders' })
  @ApiResponse({ status: 200, description: 'Summary of evaluated and dispatched reminders' })
  async triggerReminders(@CurrentUser() user: AuthUser) {
    return this.notificationsService.triggerAutomatedReminders(user);
  }
}
