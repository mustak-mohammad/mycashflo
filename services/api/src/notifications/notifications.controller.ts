import { Controller, Get, Post, Body, Param, Query, Headers, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  NotificationsService,
  DispatchNotificationDto,
  NotificationQueryDto,
} from './notifications.service.js';
import { UserRole } from '@prisma/client';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('templates')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get available notification templates with variable specs' })
  getTemplates() {
    return this.notificationsService.getTemplates();
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List tenant-scoped notifications with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated notifications list' })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notificationsService.findAll(user, query);
  }

  @Get('webhook/whatsapp')
  @ApiOperation({ summary: 'Meta WhatsApp Business API webhook challenge verification' })
  verifyWhatsAppWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.notificationsService.verifyWhatsAppWebhook(mode, token, challenge);
  }

  @Post('webhook/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive WhatsApp message delivery/read status updates' })
  handleWhatsAppWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    return this.notificationsService.handleWhatsAppWebhook(payload, signature || '');
  }

  @Post('webhook/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive transactional email delivery/bounce status updates (Resend/Svix)' })
  handleEmailWebhook(
    @Body() payload: any,
    @Headers('svix-signature') signature: string,
  ) {
    return this.notificationsService.handleEmailWebhook(payload, signature || '');
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get details of a single notification' })
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationsService.findOne(id, user);
  }

  @Post('dispatch')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Dispatch a multi-channel notification (WhatsApp, SMS, Email)' })
  @ApiResponse({ status: 201, description: 'Notification dispatched' })
  async dispatch(@CurrentUser() user: AuthUser, @Body() dto: DispatchNotificationDto) {
    return this.notificationsService.dispatch(user, dto);
  }

  @Post('trigger-reminders')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Automatically evaluate overdue invoices and dispatch multi-channel reminders (Admin/Manager only)' })
  @ApiResponse({ status: 200, description: 'Summary of evaluated and dispatched reminders' })
  async triggerReminders(@CurrentUser() user: AuthUser) {
    return this.notificationsService.triggerAutomatedReminders(user);
  }
}
