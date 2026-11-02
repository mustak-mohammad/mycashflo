import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  CompanyProfileDto,
  BatchFinancialImportDto,
  ImportCustomerItemDto,
  ImportInvoiceItemDto,
  ImportPaymentItemDto,
  CsvImportDto,
} from './onboarding.dto.js';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

export interface ImportError {
  entity: 'CUSTOMER' | 'INVOICE' | 'PAYMENT';
  identifier: string;
  field?: string;
  message: string;
}

export interface ImportResult {
  success: boolean;
  importedCustomers: number;
  importedInvoices: number;
  importedPayments: number;
  totalReceivables: number;
  errors: ImportError[];
}

export interface ImportPreviewItem<T> {
  data: T;
  rowNumber: number;
  status: 'VALID' | 'WARNING' | 'ERROR';
  errors: string[];
  calculatedOutstanding?: number;
  isExisting?: boolean;
}

export interface ImportPreviewResult {
  isValid: boolean;
  summary: {
    totalCustomers: number;
    totalInvoices: number;
    totalPayments: number;
    totalReceivables: number;
    errorCount: number;
    warningCount: number;
  };
  customers: ImportPreviewItem<ImportCustomerItemDto>[];
  invoices: ImportPreviewItem<ImportInvoiceItemDto & { customerResolvedName?: string; isOverdue: boolean }>[];
  payments: ImportPreviewItem<ImportPaymentItemDto & { isPartial: boolean; remainingInvoiceBalance: number }>[];
  errors: ImportError[];
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Save or update tenant company profile details.
   */
  async saveCompanyProfile(user: AuthUser, dto: CompanyProfileDto) {
    const { tenantId, userId } = user;
    const companyName = dto.companyName || dto.legalName || 'My Company';

    // Update tenant base name
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { name: companyName },
    });

    const normalizedDto = {
      ...dto,
      companyName,
      legalName: dto.legalName || companyName,
      billingAddress: dto.billingAddress || dto.address || '',
      email: dto.email || dto.contactEmail || '',
      contactEmail: dto.contactEmail || dto.email || '',
      defaultPaymentTerms: dto.defaultPaymentTerms || dto.defaultPaymentTermsDays || dto.defaultCreditDays || 30,
      defaultCreditDays: dto.defaultCreditDays || dto.defaultPaymentTerms || dto.defaultPaymentTermsDays || 30,
    };

    // Save extended company profile in IntegrationConfig
    const configRecord = await this.prisma.integrationConfig.upsert({
      where: {
        provider_tenantId: {
          provider: 'COMPANY_PROFILE',
          tenantId,
        },
      },
      update: {
        config: normalizedDto as any,
        isActive: true,
      },
      create: {
        provider: 'COMPANY_PROFILE',
        config: normalizedDto as any,
        isActive: true,
        tenantId,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'onboarding.company_updated',
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: { companyName, gstin: dto.gstin },
    });

    return {
      tenantId,
      ...normalizedDto,
      updatedAt: configRecord.updatedAt,
    };
  }

  /**
   * Retrieve company profile for the authenticated tenant.
   */
  async getCompanyProfile(user: AuthUser) {
    const { tenantId } = user;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const configRecord = await this.prisma.integrationConfig.findUnique({
      where: {
        provider_tenantId: {
          provider: 'COMPANY_PROFILE',
          tenantId,
        },
      },
    });

    const extended = (configRecord?.config as Record<string, any>) || {};

    return {
      tenantId,
      companyName: tenant.name,
      legalName: extended.legalName || tenant.name,
      gstin: extended.gstin || '',
      pan: extended.pan || '',
      billingAddress: extended.billingAddress || extended.address || '',
      address: extended.address || extended.billingAddress || '',
      city: extended.city || '',
      state: extended.state || '',
      postalCode: extended.postalCode || '',
      phone: extended.phone || '',
      email: extended.email || extended.contactEmail || '',
      contactEmail: extended.contactEmail || extended.email || '',
      website: extended.website || '',
      currency: extended.currency || 'INR',
      financialYearStart: extended.financialYearStart || '04-01',
      defaultCreditDays: extended.defaultCreditDays || extended.defaultPaymentTerms || 30,
      defaultPaymentTermsDays: extended.defaultPaymentTermsDays || extended.defaultPaymentTerms || extended.defaultCreditDays || 30,
      contactPreferences: extended.contactPreferences || {
        allowSms: true,
        allowWhatsapp: true,
        allowEmail: true,
        allowCalls: false,
        autoOutreachEnabled: false,
      },
      isConfigured: !!configRecord,
    };
  }

  /**
   * Batch import financial datasets: customers, invoices, and historical payments.
   * Enforces strict validation, foreign key integrity, and tenant isolation.
   */
  async importFinancialData(user: AuthUser, dto: BatchFinancialImportDto): Promise<ImportResult> {
    const { tenantId, userId } = user;
    const errors: ImportError[] = [];

    let importedCustomersCount = 0;
    let importedInvoicesCount = 0;
    let importedPaymentsCount = 0;

    // ── 1. Validate and Import Customers ─────────────────────────────────────
    const customerMap = new Map<string, string>(); // ref -> customerId

    // Pre-populate customer map with existing tenant customers
    const existingCustomers = await this.prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, email: true, phone: true, name: true },
    });
    for (const c of existingCustomers) {
      customerMap.set(c.email.toLowerCase(), c.id);
      customerMap.set(c.phone.replace(/\s+/g, ''), c.id);
      customerMap.set(c.name.toLowerCase(), c.id);
    }

    if (dto.customers && dto.customers.length > 0) {
      for (let i = 0; i < dto.customers.length; i++) {
        const item = dto.customers[i];
        const rowNum = i + 1;

        if (!item.name || !item.email || !item.phone) {
          errors.push({
            entity: 'CUSTOMER',
            identifier: item.name || `Row ${rowNum}`,
            message: 'Name, email, and phone are required for each customer.',
          });
          continue;
        }

        const cleanEmail = item.email.trim().toLowerCase();
        const cleanPhone = item.phone.trim().replace(/\s+/g, '');

        try {
          // Check if customer already exists in THIS tenant
          const existing = await this.prisma.customer.findFirst({
            where: {
              tenantId,
              OR: [{ email: cleanEmail }, { phone: cleanPhone }],
            },
          });

          let customerId: string;
          if (existing) {
            const updated = await this.prisma.customer.update({
              where: { id: existing.id },
              data: {
                name: item.name,
                company: item.company || existing.company,
                gstNumber: item.gstNumber || existing.gstNumber,
                billingAddress: item.billingAddress || existing.billingAddress,
                ...(item.openingBalance !== undefined
                  ? { outstandingBalance: { set: item.openingBalance } }
                  : {}),
              },
            });
            customerId = updated.id;
          } else {
            const created = await this.prisma.customer.create({
              data: {
                tenantId,
                name: item.name.trim(),
                email: cleanEmail,
                phone: cleanPhone,
                company: item.company?.trim(),
                gstNumber: item.gstNumber?.trim(),
                billingAddress: item.billingAddress?.trim(),
                outstandingBalance: item.openingBalance || 0,
              },
            });
            customerId = created.id;
          }

          customerMap.set(cleanEmail, customerId);
          customerMap.set(cleanPhone, customerId);
          customerMap.set(item.name.toLowerCase().trim(), customerId);
          importedCustomersCount++;
        } catch (err: any) {
          errors.push({
            entity: 'CUSTOMER',
            identifier: item.name,
            message: `Failed to import customer: ${err.message}`,
          });
        }
      }
    }

    // ── 2. Validate and Import Invoices ──────────────────────────────────────
    const invoiceMap = new Map<string, { id: string; amount: number; outstanding: number }>();

    // Pre-populate existing invoices in this tenant
    const existingInvoices = await this.prisma.invoice.findMany({
      where: { tenantId },
      select: { id: true, number: true, amount: true, outstanding: true },
    });
    for (const inv of existingInvoices) {
      invoiceMap.set(inv.number.toUpperCase(), {
        id: inv.id,
        amount: Number(inv.amount),
        outstanding: Number(inv.outstanding),
      });
    }

    if (dto.invoices && dto.invoices.length > 0) {
      for (let i = 0; i < dto.invoices.length; i++) {
        const item = dto.invoices[i];
        const rowNum = i + 1;

        if (!item.number || !item.customerRef || !item.amount || !item.issueDate || !item.dueDate) {
          errors.push({
            entity: 'INVOICE',
            identifier: item.number || `Row ${rowNum}`,
            message: 'Invoice number, customerRef, amount, issueDate, and dueDate are required.',
          });
          continue;
        }

        const invNum = item.number.trim().toUpperCase();
        const amt = Number(item.amount);
        if (isNaN(amt) || amt <= 0) {
          errors.push({
            entity: 'INVOICE',
            identifier: invNum,
            field: 'amount',
            message: `Invalid invoice amount '${item.amount}'. Amount must be greater than 0.`,
          });
          continue;
        }

        const issueDate = new Date(item.issueDate);
        const dueDate = new Date(item.dueDate);

        if (isNaN(issueDate.getTime()) || isNaN(dueDate.getTime())) {
          errors.push({
            entity: 'INVOICE',
            identifier: invNum,
            field: 'dates',
            message: 'Invalid issueDate or dueDate format. Expected YYYY-MM-DD.',
          });
          continue;
        }

        if (dueDate < issueDate) {
          errors.push({
            entity: 'INVOICE',
            identifier: invNum,
            field: 'dueDate',
            message: `Due date (${item.dueDate}) cannot be earlier than issue date (${item.issueDate}).`,
          });
          continue;
        }

        // Resolve customer
        const custRefClean = item.customerRef.trim().toLowerCase();
        const custRefPhone = item.customerRef.trim().replace(/\s+/g, '');
        const targetCustomerId =
          customerMap.get(custRefClean) || customerMap.get(custRefPhone);

        if (!targetCustomerId) {
          errors.push({
            entity: 'INVOICE',
            identifier: invNum,
            field: 'customerRef',
            message: `Customer reference '${item.customerRef}' not found in tenant database or current customer import batch.`,
          });
          continue;
        }

        try {
          const now = new Date();
          const isOverdue = dueDate < now;
          const status: InvoiceStatus = isOverdue ? 'OVERDUE' : 'OPEN';

          // Check if invoice number already exists in this tenant
          const existingInv = invoiceMap.get(invNum);
          if (existingInv) {
            // Update existing invoice
            await this.prisma.invoice.update({
              where: { id: existingInv.id },
              data: {
                amount: amt,
                issueDate,
                dueDate,
                description: item.description,
                currency: item.currency || 'INR',
              },
            });
            invoiceMap.set(invNum, { id: existingInv.id, amount: amt, outstanding: existingInv.outstanding });
          } else {
            const createdInv = await this.prisma.invoice.create({
              data: {
                tenantId,
                customerId: targetCustomerId,
                number: invNum,
                amount: amt,
                outstanding: amt,
                status,
                issueDate,
                dueDate,
                description: item.description,
                currency: item.currency || 'INR',
              },
            });
            invoiceMap.set(invNum, { id: createdInv.id, amount: amt, outstanding: amt });
          }

          importedInvoicesCount++;
        } catch (err: any) {
          errors.push({
            entity: 'INVOICE',
            identifier: invNum,
            message: `Failed to import invoice: ${err.message}`,
          });
        }
      }
    }

    // ── 3. Validate and Import Payments ──────────────────────────────────────
    if (dto.payments && dto.payments.length > 0) {
      for (let i = 0; i < dto.payments.length; i++) {
        const item = dto.payments[i];
        const rowNum = i + 1;

        if (!item.reference || !item.invoiceNumber || !item.amount || !item.paymentDate) {
          errors.push({
            entity: 'PAYMENT',
            identifier: item.reference || `Row ${rowNum}`,
            message: 'Reference, invoiceNumber, amount, and paymentDate are required.',
          });
          continue;
        }

        const invNum = item.invoiceNumber.trim().toUpperCase();
        const payAmt = Number(item.amount);

        if (isNaN(payAmt) || payAmt <= 0) {
          errors.push({
            entity: 'PAYMENT',
            identifier: item.reference,
            field: 'amount',
            message: `Invalid payment amount '${item.amount}'. Must be greater than 0.`,
          });
          continue;
        }

        const invMeta = invoiceMap.get(invNum);
        if (!invMeta) {
          errors.push({
            entity: 'PAYMENT',
            identifier: item.reference,
            field: 'invoiceNumber',
            message: `Referenced invoice '${item.invoiceNumber}' not found in tenant records.`,
          });
          continue;
        }

        const payDate = new Date(item.paymentDate);
        if (isNaN(payDate.getTime())) {
          errors.push({
            entity: 'PAYMENT',
            identifier: item.reference,
            field: 'paymentDate',
            message: `Invalid payment date format '${item.paymentDate}'. Expected YYYY-MM-DD.`,
          });
          continue;
        }

        try {
          // Normalize payment method
          let method: PaymentMethod = 'BANK_TRANSFER';
          const methodUpper = (item.paymentMethod || 'NEFT').toUpperCase();
          if (methodUpper.includes('UPI')) method = 'UPI';
          else if (methodUpper.includes('CARD')) method = 'CARD';
          else if (methodUpper.includes('CHEQUE') || methodUpper.includes('CHECK')) method = 'CHEQUE';
          else if (methodUpper.includes('CASH')) method = 'CASH';

          // Verify invoice record in database
          const targetInvoice = await this.prisma.invoice.findFirst({
            where: { id: invMeta.id, tenantId },
          });

          if (!targetInvoice) {
            errors.push({
              entity: 'PAYMENT',
              identifier: item.reference,
              message: `Target invoice ${invMeta.id} not found in current tenant.`,
            });
            continue;
          }

          // Check for duplicate payment reference within tenant
          const paymentRef = `PAY-ONBOARD-${item.reference.trim()}`;
          const existingPayment = await this.prisma.payment.findFirst({
            where: { tenantId, ref: paymentRef },
          });

          if (existingPayment) {
            // Already imported, skip duplicate
            continue;
          }

          await this.prisma.payment.create({
            data: {
              tenantId,
              ref: paymentRef,
              providerRef: item.reference.trim(),
              invoiceId: targetInvoice.id,
              customerId: targetInvoice.customerId,
              amount: payAmt,
              paidAt: payDate,
              method,
              status: PaymentStatus.COMPLETED,
              notes: 'Historical settlement imported during company onboarding',
            },
          });

          // Update invoice outstanding balance and status
          const currentOutstanding = Number(targetInvoice.outstanding);
          const newOutstanding = Math.max(0, currentOutstanding - payAmt);
          const newStatus: InvoiceStatus =
            newOutstanding === 0
              ? 'PAID'
              : newOutstanding < Number(targetInvoice.amount)
              ? 'PARTIALLY_PAID'
              : targetInvoice.status;

          await this.prisma.invoice.update({
            where: { id: targetInvoice.id },
            data: {
              outstanding: newOutstanding,
              status: newStatus,
            },
          });

          // Refresh invoice map
          invoiceMap.set(invNum, {
            id: targetInvoice.id,
            amount: Number(targetInvoice.amount),
            outstanding: newOutstanding,
          });

          importedPaymentsCount++;
        } catch (err: any) {
          errors.push({
            entity: 'PAYMENT',
            identifier: item.reference,
            message: `Failed to import payment: ${err.message}`,
          });
        }
      }
    }

    // ── 4. Rebalance Customer Outstanding Balances ───────────────────────────
    if (dto.recalculateBalances !== false) {
      const tenantCustomers = await this.prisma.customer.findMany({
        where: { tenantId },
        select: { id: true },
      });

      for (const cust of tenantCustomers) {
        const unpaidInvoices = await this.prisma.invoice.findMany({
          where: {
            customerId: cust.id,
            tenantId,
            status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
          },
          select: { outstanding: true },
        });

        const totalCustomerOutstanding = unpaidInvoices.reduce(
          (sum, inv) => sum + Number(inv.outstanding),
          0,
        );

        await this.prisma.customer.update({
          where: { id: cust.id },
          data: { outstandingBalance: totalCustomerOutstanding },
        });
      }
    }

    // Calculate total tenant receivables
    const activeInvoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: { outstanding: true },
    });
    const totalReceivables = activeInvoices.reduce((sum, inv) => sum + Number(inv.outstanding), 0);

    // Audit log import event
    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'onboarding.data_imported',
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: {
        customers: importedCustomersCount,
        invoices: importedInvoicesCount,
        payments: importedPaymentsCount,
        totalReceivables,
        errorCount: errors.length,
      },
    });

    return {
      success: errors.length === 0,
      importedCustomers: importedCustomersCount,
      importedInvoices: importedInvoicesCount,
      importedPayments: importedPaymentsCount,
      totalReceivables,
      errors,
    };
  }

  /**
   * Parse text (CSV, TSV, semicolon-separated) or Excel SpreadsheetML XML into 2D string grid.
   */
  private parseTextOrXmlToRows(content: string): string[][] {
    if (!content || !content.trim()) return [];

    const trimmed = content.trim();

    // Check if Excel SpreadsheetML XML format (.xml / .xls)
    if (trimmed.includes('<Workbook') || trimmed.includes('urn:schemas-microsoft-com:office:spreadsheet')) {
      const rows: string[][] = [];
      const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/gi;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(trimmed)) !== null) {
        const rowContent = rowMatch[1];
        const cellRegex = /<Cell[^>]*>(?:<Data[^>]*>)?([\s\S]*?)(?:<\/Data>)?<\/Cell>/gi;
        const cols: string[] = [];
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const rawCell = cellMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .trim();
          cols.push(rawCell);
        }
        if (cols.some((c) => c.length > 0)) {
          rows.push(cols);
        }
      }
      return rows;
    }

    // Delimited text (CSV, TSV, or semicolon)
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return [];

    // Auto-detect delimiter from the header line
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;

    let delimiter = ',';
    if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
    else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';

    const parseLine = (line: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === delimiter && !inQuotes) {
          values.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += ch;
        }
      }
      values.push(current.trim().replace(/^["']|["']$/g, ''));
      return values;
    };

    return lines.map(parseLine);
  }

  /**
   * Parse CSV/TSV/Excel content to BatchFinancialImportDto.
   */
  parseCsvToBatch(dto: CsvImportDto): BatchFinancialImportDto {
    const rows = this.parseTextOrXmlToRows(dto.csvContent || '');
    if (rows.length < 2) {
      throw new BadRequestException('Import content must contain at least a header row and one data row.');
    }

    const headers = rows[0].map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

    const getCol = (rowCols: string[], ...aliases: string[]): string => {
      for (const alias of aliases) {
        const idx = headers.findIndex((h) => h === alias || h.replace(/[\s_-]/g, '') === alias.replace(/[\s_-]/g, ''));
        if (idx !== -1 && rowCols[idx] !== undefined) {
          return rowCols[idx].trim();
        }
      }
      return '';
    };

    switch (dto.type) {
      case 'CUSTOMERS': {
        const customers: ImportCustomerItemDto[] = [];
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          customers.push({
            name: getCol(cols, 'name', 'customer name', 'customer', 'client'),
            email: getCol(cols, 'email', 'e-mail', 'email address'),
            phone: getCol(cols, 'phone', 'mobile', 'contact', 'telephone'),
            company: getCol(cols, 'company', 'company name', 'customer ref', 'reference'),
            gstNumber: getCol(cols, 'gstnumber', 'gstin', 'gst', 'tax id'),
            billingAddress: getCol(cols, 'billingaddress', 'address', 'billing address'),
            openingBalance: Number(getCol(cols, 'openingbalance', 'balance', 'opening balance', 'outstanding')) || 0,
          });
        }
        return { customers };
      }

      case 'INVOICES': {
        const invoices: ImportInvoiceItemDto[] = [];
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          invoices.push({
            number: getCol(cols, 'number', 'invoice number', 'invoiceno', 'invoice #', 'inv no'),
            customerRef: getCol(cols, 'customerref', 'customer', 'email', 'client', 'phone'),
            amount: parseFloat(getCol(cols, 'amount', 'total', 'invoice amount', 'total amount')) || 0,
            issueDate: getCol(cols, 'issuedate', 'date', 'issue date', 'invoice date'),
            dueDate: getCol(cols, 'duedate', 'due date', 'due'),
            description: getCol(cols, 'description', 'notes', 'particulars'),
            currency: getCol(cols, 'currency', 'curr') || 'INR',
          });
        }
        return { invoices };
      }

      case 'PAYMENTS': {
        const payments: ImportPaymentItemDto[] = [];
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          payments.push({
            reference: getCol(cols, 'reference', 'ref', 'utr', 'txn id', 'transaction id'),
            invoiceNumber: getCol(cols, 'invoicenumber', 'invoiceno', 'invoice', 'invoice #'),
            amount: parseFloat(getCol(cols, 'amount', 'paid', 'payment amount', 'paid amount')) || 0,
            paymentDate: getCol(cols, 'paymentdate', 'date', 'payment date', 'paid at'),
            paymentMethod: getCol(cols, 'paymentmethod', 'method', 'mode') || 'NEFT',
          });
        }
        return { payments };
      }

      default:
        throw new BadRequestException(`Unsupported CSV import type: ${dto.type}`);
    }
  }

  /**
   * Parse CSV content and route to importFinancialData.
   */
  async parseAndImportCsv(user: AuthUser, dto: CsvImportDto): Promise<ImportResult> {
    const batch = this.parseCsvToBatch(dto);
    return this.importFinancialData(user, batch);
  }

  /**
   * Parse CSV content and route to previewFinancialImport.
   */
  async previewCsv(user: AuthUser, dto: CsvImportDto): Promise<ImportPreviewResult> {
    const batch = this.parseCsvToBatch(dto);
    return this.previewFinancialImport(user, batch);
  }

  /**
   * Preview financial dataset validation, balance calculations, duplicate detection, and errors
   * without persisting changes to the database.
   */
  async previewFinancialImport(user: AuthUser, dto: BatchFinancialImportDto): Promise<ImportPreviewResult> {
    const { tenantId } = user;
    const errors: ImportError[] = [];

    // 1. Fetch existing tenant records for validation & FK resolution
    const [existingCustomers, existingInvoices, existingPayments] = await Promise.all([
      this.prisma.customer.findMany({
        where: { tenantId },
        select: { id: true, name: true, email: true, phone: true, outstandingBalance: true },
      }),
      this.prisma.invoice.findMany({
        where: { tenantId },
        select: { id: true, number: true, amount: true, outstanding: true, customerId: true },
      }),
      this.prisma.payment.findMany({
        where: { tenantId },
        select: { id: true, ref: true, providerRef: true, invoiceId: true },
      }),
    ]);

    const existingCustMap = new Map<string, { id: string; name: string }>();
    for (const c of existingCustomers) {
      existingCustMap.set(c.email.toLowerCase(), { id: c.id, name: c.name });
      existingCustMap.set(c.phone.replace(/\s+/g, ''), { id: c.id, name: c.name });
      existingCustMap.set(c.name.toLowerCase().trim(), { id: c.id, name: c.name });
    }

    const existingInvMap = new Map<string, { id: string; amount: number; outstanding: number; customerId: string }>();
    for (const inv of existingInvoices) {
      existingInvMap.set(inv.number.toUpperCase().trim(), {
        id: inv.id,
        amount: Number(inv.amount),
        outstanding: Number(inv.outstanding),
        customerId: inv.customerId,
      });
    }

    const existingPaymentRefs = new Set<string>();
    for (const p of existingPayments) {
      if (p.ref) existingPaymentRefs.add(p.ref);
      if (p.providerRef) existingPaymentRefs.add(p.providerRef);
      if (p.providerRef) existingPaymentRefs.add(`PAY-ONBOARD-${p.providerRef}`);
    }

    // Tracking batch data and sets for duplicate detection
    const batchCustomerEmails = new Set<string>();
    const batchCustomerPhones = new Set<string>();
    const batchInvoiceNumbers = new Set<string>();
    const batchPaymentRefs = new Set<string>();

    const previewCustomers: ImportPreviewItem<ImportCustomerItemDto>[] = [];
    const previewInvoices: ImportPreviewItem<ImportInvoiceItemDto & { customerResolvedName?: string; isOverdue: boolean }>[] = [];
    const previewPayments: ImportPreviewItem<ImportPaymentItemDto & { isPartial: boolean; remainingInvoiceBalance: number }>[] = [];

    // Map of invoice number -> payments sum in batch
    const batchInvoicePayments = new Map<string, number>();
    if (dto.payments) {
      for (const p of dto.payments) {
        if (p.invoiceNumber && Number(p.amount) > 0) {
          const k = p.invoiceNumber.trim().toUpperCase();
          batchInvoicePayments.set(k, (batchInvoicePayments.get(k) || 0) + Number(p.amount));
        }
      }
    }

    // 1. Process Customers
    if (dto.customers && dto.customers.length > 0) {
      for (let i = 0; i < dto.customers.length; i++) {
        const c = dto.customers[i];
        const rowNum = i + 1;
        const rowErrors: string[] = [];
        let status: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';

        if (!c.name || !c.name.trim()) rowErrors.push('Customer name is required.');
        if (!c.email || !c.email.trim()) {
          rowErrors.push('Email address is required.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) {
          rowErrors.push('Invalid email address format.');
        }
        if (!c.phone || !c.phone.trim()) {
          rowErrors.push('Phone number is required.');
        } else if (c.phone.replace(/[^\d+]/g, '').length < 8) {
          rowErrors.push('Invalid phone number (expected at least 8 digits).');
        }

        const emailKey = c.email?.trim().toLowerCase();
        const phoneKey = c.phone?.trim().replace(/\s+/g, '');

        if (emailKey && batchCustomerEmails.has(emailKey)) {
          rowErrors.push(`Duplicate email '${c.email}' within this import batch.`);
        }
        if (phoneKey && batchCustomerPhones.has(phoneKey)) {
          rowErrors.push(`Duplicate phone '${c.phone}' within this import batch.`);
        }

        if (emailKey) batchCustomerEmails.add(emailKey);
        if (phoneKey) batchCustomerPhones.add(phoneKey);

        const isExisting = (emailKey && existingCustMap.has(emailKey)) || (phoneKey && existingCustMap.has(phoneKey));
        if (rowErrors.length > 0) {
          status = 'ERROR';
          for (const msg of rowErrors) {
            errors.push({ entity: 'CUSTOMER', identifier: c.name || `Row ${rowNum}`, message: msg });
          }
        } else if (isExisting) {
          status = 'WARNING';
        }

        previewCustomers.push({
          data: c,
          rowNumber: rowNum,
          status,
          errors: rowErrors,
          isExisting: !!isExisting,
        });
      }
    }

    // 2. Process Invoices
    const now = new Date();
    if (dto.invoices && dto.invoices.length > 0) {
      for (let i = 0; i < dto.invoices.length; i++) {
        const inv = dto.invoices[i];
        const rowNum = i + 1;
        const rowErrors: string[] = [];
        let status: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';

        if (!inv.number || !inv.number.trim()) rowErrors.push('Invoice number is required.');
        if (!inv.customerRef || !inv.customerRef.trim()) rowErrors.push('Customer reference is required.');

        const amt = Number(inv.amount);
        if (isNaN(amt) || amt <= 0) {
          rowErrors.push(`Invalid invoice amount '${inv.amount}'. Amount must be greater than 0.`);
        }

        let issueDate: Date | null = null;
        let dueDate: Date | null = null;
        if (!inv.issueDate) {
          rowErrors.push('Issue date is required.');
        } else {
          issueDate = new Date(inv.issueDate);
          if (isNaN(issueDate.getTime())) rowErrors.push('Invalid issue date format. Expected YYYY-MM-DD.');
        }

        if (!inv.dueDate) {
          rowErrors.push('Due date is required.');
        } else {
          dueDate = new Date(inv.dueDate);
          if (isNaN(dueDate.getTime())) rowErrors.push('Invalid due date format. Expected YYYY-MM-DD.');
        }

        if (issueDate && dueDate && dueDate < issueDate) {
          rowErrors.push(`Due date (${inv.dueDate}) cannot be earlier than issue date (${inv.issueDate}).`);
        }

        const invNum = inv.number ? inv.number.trim().toUpperCase() : '';
        if (invNum && batchInvoiceNumbers.has(invNum)) {
          rowErrors.push(`Duplicate invoice number '${invNum}' within this import batch.`);
        }
        if (invNum) batchInvoiceNumbers.add(invNum);

        // Resolve customer
        const custRef = inv.customerRef ? inv.customerRef.trim().toLowerCase() : '';
        const custRefPhone = inv.customerRef ? inv.customerRef.trim().replace(/\s+/g, '') : '';
        const inBatchCust = dto.customers?.find(
          (c) =>
            c.email?.toLowerCase().trim() === custRef ||
            c.phone?.replace(/\s+/g, '') === custRefPhone ||
            c.name?.toLowerCase().trim() === custRef,
        );
        const inDbCust = existingCustMap.get(custRef) || existingCustMap.get(custRefPhone);
        const customerResolvedName = inBatchCust?.name || inDbCust?.name;

        if (!customerResolvedName) {
          rowErrors.push(`Customer reference '${inv.customerRef}' not found in tenant database or customer batch.`);
        }

        const isExisting = invNum && existingInvMap.has(invNum);
        const isOverdue = dueDate ? dueDate < now : false;

        // Calculate outstanding balance: invoice amount minus applied payments
        const paymentsForInv = invNum ? (batchInvoicePayments.get(invNum) || 0) : 0;
        const calculatedOutstanding = Math.max(0, amt - paymentsForInv);

        if (rowErrors.length > 0) {
          status = 'ERROR';
          for (const msg of rowErrors) {
            errors.push({ entity: 'INVOICE', identifier: invNum || `Row ${rowNum}`, message: msg });
          }
        } else if (isExisting) {
          status = 'WARNING';
        }

        previewInvoices.push({
          data: {
            ...inv,
            customerResolvedName,
            isOverdue,
          },
          rowNumber: rowNum,
          status,
          errors: rowErrors,
          calculatedOutstanding,
          isExisting: !!isExisting,
        });
      }
    }

    // 3. Process Payments
    if (dto.payments && dto.payments.length > 0) {
      for (let i = 0; i < dto.payments.length; i++) {
        const p = dto.payments[i];
        const rowNum = i + 1;
        const rowErrors: string[] = [];
        let status: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';

        if (!p.reference || !p.reference.trim()) rowErrors.push('Payment reference is required.');
        if (!p.invoiceNumber || !p.invoiceNumber.trim()) rowErrors.push('Invoice number is required.');

        const payAmt = Number(p.amount);
        if (isNaN(payAmt) || payAmt <= 0) {
          rowErrors.push(`Invalid payment amount '${p.amount}'. Amount must be greater than 0.`);
        }

        if (!p.paymentDate) {
          rowErrors.push('Payment date is required.');
        } else {
          const pd = new Date(p.paymentDate);
          if (isNaN(pd.getTime())) rowErrors.push('Invalid payment date format. Expected YYYY-MM-DD.');
        }

        const payRef = p.reference ? p.reference.trim() : '';
        if (payRef && batchPaymentRefs.has(payRef)) {
          rowErrors.push(`Duplicate payment reference '${payRef}' within this import batch.`);
        }
        if (payRef) batchPaymentRefs.add(payRef);

        const invNum = p.invoiceNumber ? p.invoiceNumber.trim().toUpperCase() : '';
        const inBatchInv = dto.invoices?.find((i) => i.number?.trim().toUpperCase() === invNum);
        const inDbInv = existingInvMap.get(invNum);
        const targetInvoice = inBatchInv || inDbInv;

        let remainingBalance = 0;
        let isPartial = false;

        if (!targetInvoice) {
          rowErrors.push(`Referenced invoice '${p.invoiceNumber}' not found in tenant records or current invoice batch.`);
        } else {
          const invTotal = Number(targetInvoice.amount);
          if (payAmt > invTotal) {
            rowErrors.push(`Payment amount (₹${payAmt}) exceeds invoice total amount (₹${invTotal}).`);
          }
          remainingBalance = Math.max(0, invTotal - payAmt);
          isPartial = payAmt < invTotal;
        }

        const isExisting = payRef && (existingPaymentRefs.has(payRef) || existingPaymentRefs.has(`PAY-ONBOARD-${payRef}`));

        if (rowErrors.length > 0) {
          status = 'ERROR';
          for (const msg of rowErrors) {
            errors.push({ entity: 'PAYMENT', identifier: payRef || `Row ${rowNum}`, message: msg });
          }
        } else if (isExisting) {
          status = 'WARNING';
        }

        previewPayments.push({
          data: {
            ...p,
            isPartial,
            remainingInvoiceBalance: remainingBalance,
          },
          rowNumber: rowNum,
          status,
          errors: rowErrors,
          isExisting: !!isExisting,
        });
      }
    }

    // Summary calculation
    const totalReceivables = previewInvoices.reduce((sum, inv) => {
      return inv.status !== 'ERROR' ? sum + (inv.calculatedOutstanding ?? 0) : sum;
    }, 0);

    const errorCount = errors.length;
    const warningCount =
      previewCustomers.filter((c) => c.status === 'WARNING').length +
      previewInvoices.filter((i) => i.status === 'WARNING').length +
      previewPayments.filter((p) => p.status === 'WARNING').length;

    return {
      isValid: errorCount === 0,
      summary: {
        totalCustomers: previewCustomers.length,
        totalInvoices: previewInvoices.length,
        totalPayments: previewPayments.length,
        totalReceivables,
        errorCount,
        warningCount,
      },
      customers: previewCustomers,
      invoices: previewInvoices,
      payments: previewPayments,
      errors,
    };
  }

  /**
   * Status and checklist of onboarding completion.
   * Based on persisted, tenant-isolated data.
   * Required milestones: Company Profile, Customers, Invoices.
   * Optional milestone: Payment settlements (not required if company has 0 payments).
   */
  async getOnboardingStatus(user: AuthUser) {
    const { tenantId } = user;

    const [profile, customerCount, invoiceCount, paymentCount, invoices] = await Promise.all([
      this.getCompanyProfile(user),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.invoice.count({ where: { tenantId } }),
      this.prisma.payment.count({ where: { tenantId } }),
      this.prisma.invoice.findMany({
        where: { tenantId, status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] } },
        select: { outstanding: true },
      }),
    ]);

    const totalOutstandingReceivables = invoices.reduce(
      (sum, inv) => sum + Number(inv.outstanding),
      0,
    );

    // Milestone 1: Company Profile (persisted in IntegrationConfig)
    const isProfileDone = Boolean(profile.isConfigured && (profile.legalName || profile.companyName));

    // Milestone 2: Customer Directory (at least 1 customer)
    const isCustomersDone = customerCount > 0;

    // Milestone 3: Invoices & Receivables (at least 1 invoice)
    const isInvoicesDone = invoiceCount > 0;

    // Milestone 4: Historical Payments (optional — not required if legitimately 0)
    const isPaymentsDone = paymentCount > 0;

    // 3 Required Milestones
    const requiredMilestones = [
      { id: 'COMPANY_DETAILS', label: 'Company Profile & Setup', done: isProfileDone },
      { id: 'CUSTOMERS', label: 'Customer Directory', done: isCustomersDone },
      { id: 'INVOICES', label: 'Invoices & Receivables', done: isInvoicesDone },
    ];

    const completedRequiredCount = requiredMilestones.filter((m) => m.done).length;
    const isComplete = completedRequiredCount === requiredMilestones.length;

    // Accurate completion percentage:
    // 0/3 -> 0%, 1/3 -> 33%, 2/3 -> 67%, 3/3 -> 100%
    const completionPercentage = isComplete
      ? 100
      : Math.round((completedRequiredCount / requiredMilestones.length) * 100);

    const completedSteps: string[] = [];
    if (isProfileDone) completedSteps.push('COMPANY_DETAILS', 'COMPANY_PROFILE');
    if (isCustomersDone) completedSteps.push('CUSTOMERS', 'CUSTOMERS_IMPORTED');
    if (isInvoicesDone) completedSteps.push('INVOICES', 'INVOICES_IMPORTED');
    if (isPaymentsDone) completedSteps.push('PAYMENTS', 'PAYMENTS_RECONCILED');

    const missingSteps: string[] = [];
    if (!isProfileDone) missingSteps.push('Company Profile & Tax Registration');
    if (!isCustomersDone) missingSteps.push('Customer Directory');
    if (!isInvoicesDone) missingSteps.push('Invoices & Due Dates');

    let currentStep: 'COMPANY_DETAILS' | 'CUSTOMERS' | 'INVOICES' | 'PAYMENTS' | 'COMPLETE' = 'COMPANY_DETAILS';
    let nextStepTitle = 'Setup Company Profile';

    if (!isProfileDone) {
      currentStep = 'COMPANY_DETAILS';
      nextStepTitle = 'Setup Company Profile';
    } else if (!isCustomersDone) {
      currentStep = 'CUSTOMERS';
      nextStepTitle = 'Add or Import Customers';
    } else if (!isInvoicesDone) {
      currentStep = 'INVOICES';
      nextStepTitle = 'Create or Import Invoices';
    } else {
      currentStep = 'COMPLETE';
      nextStepTitle = 'Setup Complete';
    }

    const checklist = [
      {
        id: 'COMPANY_DETAILS',
        key: 'COMPANY_DETAILS',
        title: 'Company & Tax Details',
        description: 'Organization name, billing address, and setup preferences configured',
        required: true,
        completed: isProfileDone,
        count: isProfileDone ? 1 : 0,
      },
      {
        id: 'CUSTOMERS',
        key: 'CUSTOMERS',
        title: 'Customer Directory',
        description: 'Account receivables customers registered with verified contact info',
        required: true,
        completed: isCustomersDone,
        count: customerCount,
      },
      {
        id: 'INVOICES',
        key: 'INVOICES',
        title: 'Invoices & Due Dates',
        description: 'Receivable invoices created or imported with line amounts and due dates',
        required: true,
        completed: isInvoicesDone,
        count: invoiceCount,
      },
      {
        id: 'PAYMENTS',
        key: 'PAYMENTS',
        title: 'Payment Settlements',
        description: paymentCount > 0
          ? `${paymentCount} payment settlement(s) recorded`
          : 'Optional — not required for new companies without historical payments',
        required: false,
        completed: isPaymentsDone,
        count: paymentCount,
      },
    ];

    return {
      tenantId,
      completionPercentage,
      progressPercentage: completionPercentage,
      isComplete,
      isReadyForCollections: isComplete,
      currentStep,
      nextStepTitle,
      completedSteps,
      missingSteps,
      companyProfile: profile,
      counts: {
        customers: customerCount,
        invoices: invoiceCount,
        payments: paymentCount,
      },
      metrics: {
        customerCount,
        invoiceCount,
        paymentCount,
        totalOutstandingReceivables,
      },
      checklist,
    };
  }
}
