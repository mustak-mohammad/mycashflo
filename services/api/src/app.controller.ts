import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { CurrentUser } from './auth/current-user.decorator.js';
import type { AuthUser } from './auth/current-user.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';

/** Health-check and dashboard endpoints */
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return {
      status: 'ok',
      service: 'myCashflo API',
      timestamp: new Date().toISOString(),
      version: '0.2.0',
      phase: 'Phase 3 — Connected',
    };
  }

  @Get('dashboard')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Dashboard KPIs — real-time from DB' })
  async dashboard(@CurrentUser() user: AuthUser) {
    const { tenantId } = user;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalReceivables,
      overdueStats,
      collectedThisMonth,
      openInvoiceCount,
      overdueCustomerCount,
      openCaseCount,
      recentOverdue,
    ] = await Promise.all([
      // Sum of all outstanding across active invoices
      this.prisma.invoice.aggregate({
        where: { tenantId, status: { notIn: ['PAID', 'CANCELLED'] } },
        _sum: { outstanding: true },
      }),
      // Total overdue outstanding
      this.prisma.invoice.aggregate({
        where: { tenantId, status: 'OVERDUE' },
        _sum: { outstanding: true },
        _count: true,
      }),
      // Payments received this calendar month
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED', paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      // Open/overdue invoice count
      this.prisma.invoice.count({
        where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] } },
      }),
      // Customers with at least one overdue invoice
      this.prisma.customer.count({
        where: { tenantId, invoices: { some: { status: 'OVERDUE' } } },
      }),
      // Open collection cases
      this.prisma.collectionCase.count({
        where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      // 5 most recent overdue invoices for "recent activity" feed
      this.prisma.invoice.findMany({
        where: { tenantId, status: 'OVERDUE' },
        orderBy: { dueDate: 'asc' },
        take: 5,
        include: { customer: { select: { name: true } } },
      }),
    ]);

    const receivables = Number(totalReceivables._sum.outstanding ?? 0);
    const overdue = Number(overdueStats._sum.outstanding ?? 0);
    const collected = Number(collectedThisMonth._sum.amount ?? 0);

    return {
      totalReceivables: receivables,
      overdueAmount: overdue,
      collectedThisMonth: collected,
      openInvoiceCount,
      overdueCustomerCount,
      openCaseCount,
      collectionRate: receivables > 0 ? Math.round(((receivables - overdue) / receivables) * 1000) / 10 : 0,
      recentOverdueInvoices: recentOverdue.map((inv) => ({
        id: inv.id,
        number: inv.number,
        customerName: (inv as any).customer?.name ?? '',
        outstanding: Number(inv.outstanding),
        dueDate: inv.dueDate,
        daysOverdue: Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000),
      })),
    };
  }
}
