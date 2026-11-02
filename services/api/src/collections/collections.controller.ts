import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CollectionsService, CollectionQueryDto, PatchCollectionCaseDto } from './collections.service.js';
import { CollectionsOrchestrator } from './collections.orchestrator.js';
import { IsOptional, IsBoolean, IsEnum, IsNumber } from 'class-validator';
import { NotificationChannel, UserRole } from '@prisma/client';

export class OrchestrateCollectionsDto {
  @ApiPropertyOptional({ default: false, description: 'Dry-run preview without dispatching actual notifications' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ enum: NotificationChannel, description: 'Force preferred channel (WHATSAPP, EMAIL, SMS)' })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ default: 24, description: 'Cooldown window in hours to prevent duplicate reminders' })
  @IsOptional()
  @IsNumber()
  cooldownHours?: number;

  @ApiPropertyOptional({ default: false, description: 'Override cooldown window' })
  @IsOptional()
  @IsBoolean()
  forceCooldown?: boolean;
}

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('collections')
export class CollectionsController {
  constructor(
    private readonly collectionsService: CollectionsService,
    private readonly orchestrator: CollectionsOrchestrator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List collection cases (paginated, filterable; scoped to assigned agent)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CollectionQueryDto) {
    return this.collectionsService.findAll(user, query);
  }

  @Post('orchestrate')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Run automated collections orchestration (Admin/Manager only)',
  })
  orchestrate(@CurrentUser() user: AuthUser, @Body() dto: OrchestrateCollectionsDto) {
    return this.orchestrator.orchestrate(user, dto);
  }

  @Get('orchestration/preview')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Preview collections orchestration actions without executing dispatches (Admin/Manager only)' })
  preview(@CurrentUser() user: AuthUser) {
    return this.orchestrator.orchestrate(user, { dryRun: true });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single collection case with tasks and history' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.collectionsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update case status, notes, or assignee' })
  patch(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: PatchCollectionCaseDto,
  ) {
    return this.collectionsService.patch(id, user, dto);
  }
}
