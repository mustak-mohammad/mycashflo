import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Receivables ageing — buckets based on days past due */
  async getAgeing(user: AuthUser) {
    const { tenantId } = user;
    const now = new Date();

    // Fetch all non-paid, non-cancelled overdue invoices with outstanding > 0
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
        outstanding: { gt: 0 },
        dueDate: { lt: now },
      },
      select: { dueDate: true, outstanding: true },
    });

    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };

    for (const inv of invoices) {
      const daysPast = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
      const amt = Number(inv.outstanding);
      buckets.total += amt;
      if (daysPast <= 30) buckets.d0_30 += amt;
      else if (daysPast <= 60) buckets.d31_60 += amt;
      else if (daysPast <= 90) buckets.d61_90 += amt;
      else buckets.d90plus += amt;
    }

    return buckets;
  }

  /** KPI summary */
  async getSummary(user: AuthUser) {
    const { tenantId } = user;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalBilled,
      totalCollected,
      totalOverdue,
      openInvoices,
      overdueCustomers,
      promiseToPay,
      collectedThisMonth,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { tenantId, status: { not: 'CANCELLED' } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: { tenantId, status: 'OVERDUE' },
        _sum: { outstanding: true },
      }),
      this.prisma.invoice.count({
        where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] } },
      }),
      this.prisma.customer.count({
        where: { tenantId, invoices: { some: { status: 'OVERDUE' } } },
      }),
      this.prisma.paymentPromise.count({
        where: { tenantId, status: 'PENDING' },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED', paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const billed = Number(totalBilled._sum.amount ?? 0);
    const collected = Number(totalCollected._sum.amount ?? 0);
    const overdue = Number(totalOverdue._sum.outstanding ?? 0);

    return {
      totalBilled: billed,
      totalCollected: collected,
      totalOverdue: overdue,
      openInvoices,
      overdueCustomers,
      promiseToPay,
      collectionRate: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0,
      collectedThisMonth: Number(collectedThisMonth._sum.amount ?? 0),
    };
  }
}
