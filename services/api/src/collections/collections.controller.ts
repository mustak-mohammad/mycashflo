import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CollectionsService, CollectionQueryDto, PatchCollectionCaseDto } from './collections.service.js';

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List collection cases (paginated, filterable)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: CollectionQueryDto) {
    return this.collectionsService.findAll(user, query);
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
