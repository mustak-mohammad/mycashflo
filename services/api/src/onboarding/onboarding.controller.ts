import { Controller, Get, Post, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { OnboardingService } from './onboarding.service.js';
import { CompanyProfileDto, BatchFinancialImportDto, CsvImportDto } from './onboarding.dto.js';
import { UserRole } from '@prisma/client';

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('company')
  @ApiOperation({ summary: 'Get current company details and onboarding configuration' })
  async getCompanyProfile(@CurrentUser() user: AuthUser) {
    return this.onboarding.getCompanyProfile(user);
  }

  @Post('company')
  @ApiOperation({ summary: 'Configure or update company details and tax registration' })
  async saveCompanyProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: CompanyProfileDto,
  ) {
    return this.onboarding.saveCompanyProfile(user, dto);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview and validate batch financial datasets without saving' })
  async previewFinancialData(
    @CurrentUser() user: AuthUser,
    @Body() dto: BatchFinancialImportDto,
  ) {
    return this.onboarding.previewFinancialImport(user, dto);
  }

  @Post('preview/csv')
  @ApiOperation({ summary: 'Preview and validate financial dataset from raw CSV/Excel text without saving' })
  async previewCsv(
    @CurrentUser() user: AuthUser,
    @Body() dto: CsvImportDto,
  ) {
    return this.onboarding.previewCsv(user, dto);
  }

  @Post('import')
  @ApiOperation({ summary: 'Batch import financial datasets (customers, invoices, payments) with validation' })
  async importFinancialData(
    @CurrentUser() user: AuthUser,
    @Body() dto: BatchFinancialImportDto,
  ) {
    return this.onboarding.importFinancialData(user, dto);
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Import financial dataset from raw CSV text' })
  async importCsv(
    @CurrentUser() user: AuthUser,
    @Body() dto: CsvImportDto,
  ) {
    return this.onboarding.parseAndImportCsv(user, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Checklist and readiness status for new company onboarding' })
  async getStatus(@CurrentUser() user: AuthUser) {
    return this.onboarding.getOnboardingStatus(user);
  }
}
