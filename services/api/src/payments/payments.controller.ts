import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  PaymentsService,
  PaymentQueryDto,
  CreatePaymentLinkDto,
  CreateRazorpayOrderDto,
  VerifyRazorpayPaymentDto,
  RecordPaymentDto,
  RecordPaymentClaimDto,
  RejectPaymentClaimDto,
} from './payments.service.js';
import { UserRole } from '@prisma/client';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List payment records (paginated, scoped to assigned customers for Agents)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.paymentsService.findAll(user, query);
  }

  @Get('stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Aggregated payment statistics (scoped to assigned customers for Agents)' })
  getStats(@CurrentUser() user: AuthUser) {
    return this.paymentsService.getStats(user);
  }

  @Post('record')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Manually record a settlement payment against an invoice (Admin/Manager only)' })
  recordPayment(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentDto) {
    return this.paymentsService.recordPayment(user, dto);
  }

  @Post('claim')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record customer payment claim awaiting verification without balance reduction' })
  recordPaymentClaim(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentClaimDto) {
    return this.paymentsService.recordPaymentClaim(user, dto);
  }

  @Post(':id/verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Verify and reconcile a pending payment claim (Admin/Manager only)' })
  verifyPaymentClaim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.paymentsService.verifyPaymentClaim(id, user);
  }

  @Post(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject an unverified payment claim without altering invoice balance (Admin/Manager only)' })
  rejectPaymentClaim(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto?: RejectPaymentClaimDto,
  ) {
    return this.paymentsService.rejectPaymentClaim(id, user, dto);
  }

  @Post('link')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate a payment link for an invoice via Razorpay or Stripe' })
  createPaymentLink(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentLinkDto) {
    return this.paymentsService.createPaymentLink(user, dto);
  }

  @Post('razorpay/order')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a Razorpay Standard Checkout order for an open invoice' })
  createRazorpayOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateRazorpayOrderDto) {
    return this.paymentsService.createRazorpayOrder(user, dto);
  }

  @Post('razorpay/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Verify Razorpay Checkout payment signature and reconcile invoice atomically' })
  verifyRazorpayPayment(@CurrentUser() user: AuthUser, @Body() dto: VerifyRazorpayPaymentDto) {
    return this.paymentsService.verifyRazorpayPayment(user, dto);
  }

  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive payment confirmation webhook from provider' })
  handleWebhook(
    @Param('provider') provider: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
    @Req() req: any,
  ) {
    return this.paymentsService.handleWebhook(provider, payload, headers, req?.rawBody);
  }
}
