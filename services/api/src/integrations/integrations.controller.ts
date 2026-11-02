import { Controller, Get, Put, Post, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IntegrationsService } from './integrations.service.js';
import { UserRole } from '@prisma/client';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: 'List configured tenant integrations with masked secrets' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.integrationsService.getConfigs(user);
  }

  @Put(':provider')
  @ApiOperation({ summary: 'Save or update configuration for an external provider' })
  saveConfig(
    @CurrentUser() user: AuthUser,
    @Param('provider') provider: string,
    @Body() dto: { config: Record<string, any>; isActive?: boolean },
  ) {
    return this.integrationsService.saveConfig(user, provider, dto);
  }

  @Post(':provider/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test connectivity and validation for a provider' })
  testConnection(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    return this.integrationsService.testConnection(user, provider);
  }
}

