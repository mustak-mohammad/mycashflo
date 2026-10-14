import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { PaymentsService, PaymentQueryDto } from './payments.service.js';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List payment records (paginated)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.paymentsService.findAll(user, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregated payment statistics' })
  getStats(@CurrentUser() user: AuthUser) {
    return this.paymentsService.getStats(user);
  }
}
