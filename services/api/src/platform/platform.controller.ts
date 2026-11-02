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
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { PlatformService } from './platform.service.js';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
  PlatformAuditLogsQueryDto,
  UpdatePlatformUserRoleDto,
  UpdatePlatformUserStatusDto,
  PlatformUsersQueryDto,
} from './dto/platform.dto.js';
import { UserRole } from '@prisma/client';

@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Platform-wide summary KPIs across all tenants (Super Admin only)' })
  getSummary(@CurrentUser() user: AuthUser) {
    return this.platformService.getSummary(user);
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List all platform tenants and operational metrics (Super Admin only)' })
  listTenants(@CurrentUser() user: AuthUser) {
    return this.platformService.listTenants(user);
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Create a new tenant organization on the platform (Super Admin only)' })
  createTenant(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.platformService.createTenant(user, dto);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get single tenant details and user roster (Super Admin only)' })
  getTenant(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.platformService.getTenant(id, user);
  }

  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Update tenant name or slug (Super Admin only)' })
  updateTenant(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.platformService.updateTenant(id, user, dto);
  }

  @Patch('tenants/:id/status')
  @ApiOperation({ summary: 'Activate or suspend tenant user access (Super Admin only)' })
  updateTenantStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.platformService.updateTenantStatus(id, user, dto);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'List platform-wide audit logs with cross-tenant visibility (Super Admin only)' })
  listPlatformAuditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: PlatformAuditLogsQueryDto,
  ) {
    return this.platformService.listPlatformAuditLogs(user, query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Retrieve platform-wide operational settings and health indicators (Super Admin only)' })
  getPlatformSettings(@CurrentUser() user: AuthUser) {
    return this.platformService.getPlatformSettings(user);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Retrieve platform-wide aggregate growth and analytics (Super Admin only)' })
  getPlatformAnalytics(@CurrentUser() user: AuthUser) {
    return this.platformService.getPlatformAnalytics(user);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users across all tenants (Super Admin only)' })
  listUsers(@CurrentUser() user: AuthUser, @Query() query: PlatformUsersQueryDto) {
    return this.platformService.listUsers(user, query);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update a user role across any tenant (Super Admin only)' })
  updateUserRole(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePlatformUserRoleDto,
  ) {
    return this.platformService.updateUserRole(id, user, dto);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a user across any tenant (Super Admin only)' })
  updateUserStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePlatformUserStatusDto,
  ) {
    return this.platformService.updateUserStatus(id, user, dto);
  }

  @Get('tenants/:id/audit-logs')
  @ApiOperation({ summary: 'View tenant audit log trail cross-tenant (Super Admin only)' })
  getTenantAuditLogs(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.platformService.getTenantAuditLogs(id, user);
  }
}

