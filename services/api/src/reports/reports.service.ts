import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

export interface LedgerEntryItem {
  id: string;
  date: string;
  ref: string;
  type: 'INVOICE' | 'PAYMENT';
  customerId: string;
  customerName: string;
  invoiceNumber?: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  status: string;
  currency: string;
}

export interface LedgerSummaryResult {
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  netBalance: number;
  entryCount: number;
  currency: string;
}

export interface LedgerResult {
  data: LedgerEntryItem[];
  summary: LedgerSummaryResult;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getAgentCustomerIds(tenantId: string, userId: string): Promise<string[]> {
    try {
      const [assignedCases, assignedTasks] = await Promise.all([
        this.prisma.collectionCase?.findMany
          ? this.prisma.collectionCase.findMany({
              where: { tenantId, assignedTo: userId },
              select: { customerId: true },
            })
          : [],
        this.prisma.followUpTask?.findMany
          ? this.prisma.followUpTask.findMany({
              where: { tenantId, assignedTo: userId, customerId: { not: null } },
              select: { customerId: true },
            })
          : [],
      ]);
      const allowed = new Set<string>();
      (assignedCases || []).forEach((c: any) => c.customerId && allowed.add(c.customerId));
      (assignedTasks || []).forEach((t: any) => t.customerId && allowed.add(t.customerId));
      return Array.from(allowed);
    } catch {
      return [];
    }
  }

  /** Receivables ageing — buckets based on days past due */
  async getAgeing(user: AuthUser) {
    const { tenantId, role, userId } = user;
    const now = new Date();

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      assignedFilter = { customerId: { in: allowedCustomerIds } };
    }

    // Fetch all non-paid, non-cancelled overdue invoices with outstanding > 0
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        ...assignedFilter,
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
  async getSummary(
    user: AuthUser,
    query?: { dateRange?: string; startDate?: string; endDate?: string },
  ) {
    const { tenantId, role, userId } = user;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      assignedFilter = { customerId: { in: allowedCustomerIds } };
    }

    // Date range filter matching AppController
    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (query?.dateRange === '30d') {
      dateFilter = { gte: new Date(now.getTime() - 30 * 86_400_000) };
    } else if (query?.dateRange === '90d') {
      dateFilter = { gte: new Date(now.getTime() - 90 * 86_400_000) };
    } else if (query?.dateRange === 'this_month') {
      dateFilter = { gte: startOfMonth };
    } else if (query?.dateRange === 'this_year') {
      dateFilter = { gte: new Date(now.getFullYear(), 0, 1) };
    } else if (query?.startDate || query?.endDate) {
      dateFilter = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate);
      if (query.endDate) dateFilter.lte = new Date(query.endDate);
    }

    const [
      totalReceivables,
      totalBilled,
      totalCollected,
      totalOverdue,
      openInvoices,
      overdueCustomers,
      promiseToPay,
      collectedThisMonth,
    ] = await Promise.all([
      // Sum of all outstanding receivables (not PAID, CANCELLED, or DRAFT, with outstanding > 0)
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          ...assignedFilter,
          status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
          outstanding: { gt: 0 },
          ...(dateFilter ? { issueDate: dateFilter } : {}),
        },
        _sum: { outstanding: true },
      }),
      // Total Billed across active non-cancelled invoices
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          ...assignedFilter,
          status: { notIn: ['CANCELLED', 'DRAFT'] },
          ...(dateFilter ? { issueDate: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      // Total Collected amount across completed payments in selected dateRange (or all-time if all)
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          ...assignedFilter,
          status: 'COMPLETED',
          ...(dateFilter ? { paidAt: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      // Total Overdue outstanding (past due date or status OVERDUE, with outstanding > 0)
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          ...assignedFilter,
          status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
          outstanding: { gt: 0 },
          OR: [{ status: 'OVERDUE' }, { dueDate: { lt: now } }],
          ...(dateFilter ? { issueDate: dateFilter } : {}),
        },
        _sum: { outstanding: true },
      }),
      // Open Invoices count (strictly outstanding > 0)
      this.prisma.invoice.count({
        where: {
          tenantId,
          ...assignedFilter,
          status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstanding: { gt: 0 },
          ...(dateFilter ? { issueDate: dateFilter } : {}),
        },
      }),
      // Overdue Customers count (strictly outstanding > 0)
      this.prisma.customer.count({
        where: {
          tenantId,
          ...(role === 'AGENT' && assignedFilter.customerId ? { id: assignedFilter.customerId } : {}),
          invoices: {
            some: {
              status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
              outstanding: { gt: 0 },
              OR: [{ status: 'OVERDUE' }, { dueDate: { lt: now } }],
              ...(dateFilter ? { issueDate: dateFilter } : {}),
            },
          },
        },
      }),
      // Pending Promises to Pay
      this.prisma.paymentPromise.count({
        where: {
          tenantId,
          ...(role === 'AGENT' && assignedFilter.customerId ? { invoice: { customerId: assignedFilter.customerId } } : {}),
          status: 'PENDING',
        },
      }),
      // Payments received this month
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          ...assignedFilter,
          status: 'COMPLETED',
          paidAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);

    const billed = Number(totalBilled._sum?.amount ?? 0);
    const collected = Number(totalCollected._sum?.amount ?? 0);
    const receivables = Number(totalReceivables._sum?.outstanding ?? 0);
    const overdue = Number(totalOverdue._sum?.outstanding ?? 0);

    return {
      totalReceivables: receivables,
      totalBilled: billed,
      totalCollected: collected,
      totalOverdue: overdue,
      openInvoices,
      overdueCustomers,
      promiseToPay,
      collectionRate: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0,
      collectedThisMonth: Number(collectedThisMonth._sum?.amount ?? 0),
    };
  }

  /**
   * Customer Ledger — chronological list of invoices (debits) and completed payments (credits)
   * with running balance and opening balance calculations.
   */
  async getLedger(
    user: AuthUser,
    query: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<LedgerResult> {
    const { tenantId, role, userId } = user;
    const { customerId, startDate, endDate } = query;

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (customerId && !allowedCustomerIds.includes(customerId)) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer');
      }
      if (!customerId) {
        assignedFilter = { customerId: { in: allowedCustomerIds } };
      }
    }

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    // 1. Calculate opening balance if startDate is specified
    let openingBalance = 0;
    if (start) {
      const [priorInvoices, priorPayments] = await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            tenantId,
            ...assignedFilter,
            ...(customerId ? { customerId } : {}),
            status: { not: 'CANCELLED' },
            issueDate: { lt: start },
          },
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            tenantId,
            ...assignedFilter,
            ...(customerId ? { customerId } : {}),
            status: 'COMPLETED',
            paidAt: { lt: start },
          },
          _sum: { amount: true },
        }),
      ]);

      const priorDebit = Number(priorInvoices._sum.amount ?? 0);
      const priorCredit = Number(priorPayments._sum.amount ?? 0);
      openingBalance = Math.round((priorDebit - priorCredit) * 100) / 100;
    }

    // 2. Fetch Invoices in period
    const invoiceWhere: any = {
      tenantId,
      ...assignedFilter,
      status: { not: 'CANCELLED' },
    };
    if (customerId) invoiceWhere.customerId = customerId;
    if (start || end) {
      invoiceWhere.issueDate = {};
      if (start) invoiceWhere.issueDate.gte = start;
      if (end) invoiceWhere.issueDate.lte = end;
    }

    const invoices = await this.prisma.invoice.findMany({
      where: invoiceWhere,
      include: {
        customer: { select: { id: true, name: true, company: true } },
      },
      orderBy: { issueDate: 'asc' },
    });

    // 3. Fetch Payments in period
    const paymentWhere: any = {
      tenantId,
      ...assignedFilter,
      status: 'COMPLETED',
    };
    if (customerId) paymentWhere.customerId = customerId;
    if (start || end) {
      paymentWhere.paidAt = {};
      if (start) paymentWhere.paidAt.gte = start;
      if (end) paymentWhere.paidAt.lte = end;
    }

    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      include: {
        customer: { select: { id: true, name: true, company: true } },
        invoice: { select: { number: true } },
      },
      orderBy: { paidAt: 'asc' },
    });

    // 4. Assemble entries into a single timeline
    const rawEntries: LedgerEntryItem[] = [];

    for (const inv of invoices) {
      rawEntries.push({
        id: `inv_${inv.id}`,
        date: (inv.issueDate || inv.createdAt).toISOString(),
        ref: inv.number,
        type: 'INVOICE',
        customerId: inv.customerId,
        customerName: inv.customer?.name || 'Unknown',
        invoiceNumber: inv.number,
        description: inv.description || `Invoice #${inv.number} issued`,
        debit: Number(inv.amount),
        credit: 0,
        runningBalance: 0,
        status: inv.status,
        currency: inv.currency || 'INR',
      });
    }

    for (const pmt of payments) {
      rawEntries.push({
        id: `pmt_${pmt.id}`,
        date: (pmt.paidAt || pmt.createdAt).toISOString(),
        ref: pmt.ref,
        type: 'PAYMENT',
        customerId: pmt.customerId,
        customerName: pmt.customer?.name || 'Unknown',
        invoiceNumber: pmt.invoice?.number || undefined,
        description: pmt.notes || `Payment received via ${pmt.method}`,
        debit: 0,
        credit: Number(pmt.amount),
        runningBalance: 0,
        status: pmt.status,
        currency: pmt.currency || 'INR',
      });
    }

    // Sort chronologically (oldest first)
    rawEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 5. Compute running balances
    let currentBalance = openingBalance;
    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of rawEntries) {
      totalDebits += entry.debit;
      totalCredits += entry.credit;
      currentBalance = currentBalance + entry.debit - entry.credit;
      entry.runningBalance = Math.round(currentBalance * 100) / 100;
    }

    return {
      data: rawEntries,
      summary: {
        openingBalance,
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        netBalance: Math.round(currentBalance * 100) / 100,
        entryCount: rawEntries.length,
        currency: 'INR',
      },
    };
  }

  /**
   * Export Customer Ledger to CSV with safe formula injection mitigation.
   */
  async exportLedgerCsv(
    user: AuthUser,
    query: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<string> {
    const ledger = await this.getLedger(user, query);

    const escapeCell = (val: any): string => {
      let str = val === null || val === undefined ? '' : String(val);
      // Formula injection defense: prepend apostrophe if string begins with =, +, -, @, \t, \r
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows: string[] = [];

    // Header row
    rows.push(
      [
        'Date',
        'Reference',
        'Type',
        'Customer Name',
        'Invoice Number',
        'Description',
        'Debit (INR)',
        'Credit (INR)',
        'Running Balance (INR)',
        'Status',
      ].join(','),
    );

    // Opening balance row if non-zero
    if (ledger.summary.openingBalance !== 0) {
      rows.push(
        [
          query.startDate || '',
          'OPENING_BAL',
          'BALANCE',
          'Opening Balance',
          '',
          'Balance brought forward',
          '0.00',
          '0.00',
          ledger.summary.openingBalance.toFixed(2),
          'SETTLED',
        ].map(escapeCell).join(','),
      );
    }

    for (const item of ledger.data) {
      rows.push(
        [
          item.date.slice(0, 10),
          item.ref,
          item.type,
          item.customerName,
          item.invoiceNumber || '',
          item.description,
          item.debit.toFixed(2),
          item.credit.toFixed(2),
          item.runningBalance.toFixed(2),
          item.status,
        ].map(escapeCell).join(','),
      );
    }

    // Summary footer rows
    rows.push('');
    rows.push(['--- SUMMARY ---'].join(','));
    rows.push(['Total Debits', '', '', '', '', '', ledger.summary.totalDebits.toFixed(2)].map(escapeCell).join(','));
    rows.push(['Total Credits', '', '', '', '', '', '', ledger.summary.totalCredits.toFixed(2)].map(escapeCell).join(','));
    rows.push(['Net Balance', '', '', '', '', '', '', '', ledger.summary.netBalance.toFixed(2)].map(escapeCell).join(','));

    return rows.join('\r\n');
  }

  /**
   * Export Customer Ledger to SpreadsheetML XML (Excel native format compatible with .xls / .xlsx)
   */
  async exportLedgerExcelXml(
    user: AuthUser,
    query: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<string> {
    const ledger = await this.getLedger(user, query);

    const escapeXml = (unsafe: any) => {
      const str = unsafe === null || unsafe === undefined ? '' : String(unsafe);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Currency">
   <NumberFormat ss:Format="#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="BoldCurrency">
   <Font ss:Bold="1"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="DateStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Customer Ledger">
  <Table>
   <Column ss:Width="90"/>
   <Column ss:Width="110"/>
   <Column ss:Width="80"/>
   <Column ss:Width="150"/>
   <Column ss:Width="100"/>
   <Column ss:Width="200"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="120"/>
   <Column ss:Width="90"/>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Date</Data></Cell>
    <Cell><Data ss:Type="String">Reference</Data></Cell>
    <Cell><Data ss:Type="String">Type</Data></Cell>
    <Cell><Data ss:Type="String">Customer Name</Data></Cell>
    <Cell><Data ss:Type="String">Invoice No</Data></Cell>
    <Cell><Data ss:Type="String">Description</Data></Cell>
    <Cell><Data ss:Type="String">Debit (INR)</Data></Cell>
    <Cell><Data ss:Type="String">Credit (INR)</Data></Cell>
    <Cell><Data ss:Type="String">Running Balance</Data></Cell>
    <Cell><Data ss:Type="String">Status</Data></Cell>
   </Row>`;

    for (const item of ledger.data) {
      xml += `
   <Row>
    <Cell ss:StyleID="DateStyle"><Data ss:Type="String">${escapeXml(item.date.slice(0, 10))}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.ref)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.type)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.customerName)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.invoiceNumber || '')}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.description)}</Data></Cell>
    <Cell ss:StyleID="Currency"><Data ss:Type="Number">${item.debit}</Data></Cell>
    <Cell ss:StyleID="Currency"><Data ss:Type="Number">${item.credit}</Data></Cell>
    <Cell ss:StyleID="Currency"><Data ss:Type="Number">${item.runningBalance}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(item.status)}</Data></Cell>
   </Row>`;
    }

    // Totals row
    xml += `
   <Row>
    <Cell ss:StyleID="Header"><Data ss:Type="String">TOTALS</Data></Cell>
    <Cell></Cell><Cell></Cell><Cell></Cell><Cell></Cell><Cell></Cell>
    <Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${ledger.summary.totalDebits}</Data></Cell>
    <Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${ledger.summary.totalCredits}</Data></Cell>
    <Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${ledger.summary.netBalance}</Data></Cell>
    <Cell></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;

    return xml;
  }
}

