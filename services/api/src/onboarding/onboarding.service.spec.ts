import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingService } from './onboarding.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockPrisma: any;
  let mockAuditLogs: any;

  let tenants: any[];
  let configs: any[];
  let customers: any[];
  let invoices: any[];
  let payments: any[];

  const mockUser: AuthUser = {
    userId: 'user_onboard_01',
    tenantId: 'tenant_onboard_01',
    role: 'ADMIN',
  };

  beforeEach(() => {
    tenants = [
      { id: 'tenant_onboard_01', name: 'Original Tenant Name', slug: 'orig-tenant' },
      { id: 'tenant_other_02', name: 'Other Tenant', slug: 'other-tenant' },
    ];
    configs = [];
    customers = [];
    invoices = [];
    payments = [];

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_log_001' }),
    };

    mockPrisma = {
      tenant: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          return tenants.find((t) => t.id === where.id) || null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const t = tenants.find((t) => t.id === where.id);
          if (t) Object.assign(t, data);
          return t;
        }),
      },
      integrationConfig: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          return (
            configs.find(
              (c) =>
                c.tenantId === where.provider_tenantId?.tenantId &&
                c.provider === where.provider_tenantId?.provider,
            ) || null
          );
        }),
        upsert: vi.fn().mockImplementation(async ({ where, update, create }) => {
          let c = configs.find(
            (item) =>
              item.tenantId === where.provider_tenantId?.tenantId &&
              item.provider === where.provider_tenantId?.provider,
          );
          if (c) {
            Object.assign(c, update, { updatedAt: new Date() });
          } else {
            c = { id: `cfg_${Date.now()}`, ...create, updatedAt: new Date() };
            configs.push(c);
          }
          return c;
        }),
      },
      customer: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return customers.filter((c) => c.tenantId === where.tenantId);
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            customers.find((c) => {
              if (c.tenantId !== where.tenantId) return false;
              if (where.id && c.id !== where.id) return false;
              if (where.OR) {
                return where.OR.some(
                  (cond: any) =>
                    (cond.email && c.email.toLowerCase() === cond.email.toLowerCase()) ||
                    (cond.phone && c.phone === cond.phone),
                );
              }
              return true;
            }) || null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newCust = { id: `cust_${Date.now()}_${Math.random()}`, ...data };
          customers.push(newCust);
          return newCust;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const c = customers.find((item) => item.id === where.id);
          if (c) {
            if (data.outstandingBalance?.set !== undefined) {
              c.outstandingBalance = data.outstandingBalance.set;
            } else if (data.outstandingBalance !== undefined) {
              c.outstandingBalance = data.outstandingBalance;
            }
            if (data.name) c.name = data.name;
            if (data.company) c.company = data.company;
            if (data.gstNumber) c.gstNumber = data.gstNumber;
            if (data.billingAddress) c.billingAddress = data.billingAddress;
          }
          return c;
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return customers.filter((c) => c.tenantId === where.tenantId).length;
        }),
      },
      invoice: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return invoices.filter((inv) => {
            if (inv.tenantId !== where.tenantId) return false;
            if (where.customerId && inv.customerId !== where.customerId) return false;
            if (where.status?.in && !where.status.in.includes(inv.status)) return false;
            return true;
          });
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            invoices.find(
              (inv) =>
                inv.id === where.id && (where.tenantId === undefined || inv.tenantId === where.tenantId),
            ) || null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newInv = { id: `inv_${Date.now()}_${Math.random()}`, ...data };
          invoices.push(newInv);
          return newInv;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const inv = invoices.find((item) => item.id === where.id);
          if (inv) Object.assign(inv, data);
          return inv;
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return invoices.filter((inv) => inv.tenantId === where.tenantId).length;
        }),
      },
      payment: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return payments.filter((p) => p.tenantId === where.tenantId);
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            payments.find(
              (p) =>
                p.tenantId === where.tenantId &&
                (where.reference ? p.reference === where.reference : true),
            ) || null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newPay = { id: `pay_${Date.now()}_${Math.random()}`, ...data };
          payments.push(newPay);
          return newPay;
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return payments.filter((p) => p.tenantId === where.tenantId).length;
        }),
      },
    };

    service = new OnboardingService(mockPrisma, mockAuditLogs);
  });

  describe('Company Profile Configuration', () => {
    it('saves company profile and updates tenant name', async () => {
      const result = await service.saveCompanyProfile(mockUser, {
        companyName: 'Acme Cloudworks Pvt Ltd',
        legalName: 'Acme Cloudworks Private Limited',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        billingAddress: '42 MG Road, Bengaluru',
        phone: '+919876543210',
        email: 'accounts@acmecloudworks.in',
        currency: 'INR',
        defaultCreditDays: 45,
      });

      expect(result.companyName).toBe('Acme Cloudworks Pvt Ltd');
      expect(result.gstin).toBe('29ABCDE1234F1Z5');
      expect(tenants[0].name).toBe('Acme Cloudworks Pvt Ltd');
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'onboarding.company_updated' }),
      );
    });

    it('retrieves company profile accurately', async () => {
      await service.saveCompanyProfile(mockUser, {
        companyName: 'Acme Cloudworks Pvt Ltd',
        gstin: '29ABCDE1234F1Z5',
        billingAddress: 'Bengaluru',
      });

      const profile = await service.getCompanyProfile(mockUser);
      expect(profile.companyName).toBe('Acme Cloudworks Pvt Ltd');
      expect(profile.gstin).toBe('29ABCDE1234F1Z5');
      expect(profile.isConfigured).toBe(true);
    });
  });

  describe('Batch Financial Data Import & Validation', () => {
    it('successfully imports customers, invoices, and payments in one batch', async () => {
      const result = await service.importFinancialData(mockUser, {
        customers: [
          {
            name: 'Delta Corp',
            email: 'billing@deltacorp.in',
            phone: '+919876500001',
            company: 'Delta Corp Ltd',
            gstNumber: '27AAACD1234E1Z1',
            openingBalance: 10000,
          },
        ],
        invoices: [
          {
            number: 'INV-DELTA-101',
            customerRef: 'billing@deltacorp.in',
            amount: 75000,
            issueDate: '2026-09-01',
            dueDate: '2026-09-30',
            description: 'Cloud hosting services Q3',
          },
        ],
        payments: [
          {
            reference: 'PAY-UTR-DELTA-999',
            invoiceNumber: 'INV-DELTA-101',
            amount: 25000,
            paymentDate: '2026-10-05',
            paymentMethod: 'NEFT',
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.importedCustomers).toBe(1);
      expect(result.importedInvoices).toBe(1);
      expect(result.importedPayments).toBe(1);
      expect(result.errors.length).toBe(0);

      // Verify invoice was updated with partial payment: 75000 - 25000 = 50000
      const invoice = invoices.find((inv) => inv.number === 'INV-DELTA-101');
      expect(invoice.outstanding).toBe(50000);
      expect(invoice.status).toBe('PARTIALLY_PAID');

      // Verify customer outstanding balance was rebalanced to 50000
      const customer = customers.find((c) => c.email === 'billing@deltacorp.in');
      expect(customer.outstandingBalance).toBe(50000);
    });

    it('rejects invoice when due date is earlier than issue date', async () => {
      const result = await service.importFinancialData(mockUser, {
        customers: [
          {
            name: 'Alpha Traders',
            email: 'alpha@traders.in',
            phone: '+919876500002',
          },
        ],
        invoices: [
          {
            number: 'INV-BAD-DATE-001',
            customerRef: 'alpha@traders.in',
            amount: 30000,
            issueDate: '2026-10-15',
            dueDate: '2026-10-01', // Earlier than issue date!
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].field).toBe('dueDate');
      expect(result.errors[0].message).toContain('cannot be earlier than issue date');
      expect(result.importedInvoices).toBe(0);
    });

    it('rejects invoice when customer reference cannot be resolved', async () => {
      const result = await service.importFinancialData(mockUser, {
        invoices: [
          {
            number: 'INV-ORPHAN-001',
            customerRef: 'unknown-customer@nonexistent.in',
            amount: 40000,
            issueDate: '2026-10-01',
            dueDate: '2026-10-31',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain('not found in tenant database');
    });

    it('enforces strict tenant isolation: cannot attach invoice to customer of another tenant', async () => {
      // Create customer in tenant_other_02
      customers.push({
        id: 'cust_other_tenant_99',
        tenantId: 'tenant_other_02',
        name: 'Foreign Tenant Client',
        email: 'foreign@othercorp.in',
        phone: '+919876599999',
      });

      // User in tenant_onboard_01 attempts to create invoice for foreign@othercorp.in
      const result = await service.importFinancialData(mockUser, {
        invoices: [
          {
            number: 'INV-CROSS-001',
            customerRef: 'foreign@othercorp.in',
            amount: 50000,
            issueDate: '2026-10-01',
            dueDate: '2026-10-31',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('not found in tenant database');
      expect(invoices.length).toBe(0);
    });

    it('rejects payments referencing unknown invoices', async () => {
      const result = await service.importFinancialData(mockUser, {
        payments: [
          {
            reference: 'PAY-UNKNOWN-001',
            invoiceNumber: 'INV-NONEXISTENT-999',
            amount: 15000,
            paymentDate: '2026-10-01',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('not found in tenant records');
    });
  });

  describe('CSV Import Parsing', () => {
    it('parses customer CSV and imports records', async () => {
      const csv = `Name,Email,Phone,Company,OpeningBalance\nBeta Logistics,beta@logistics.in,+919876543299,Beta Logistics Pvt Ltd,25000`;
      const result = await service.parseAndImportCsv(mockUser, {
        type: 'CUSTOMERS',
        csvContent: csv,
      });

      expect(result.success).toBe(true);
      expect(result.importedCustomers).toBe(1);
      expect(customers.length).toBe(1);
      expect(customers[0].email).toBe('beta@logistics.in');
    });

    it('parses invoice CSV and links to customer', async () => {
      // First add customer
      customers.push({
        id: 'cust_beta',
        tenantId: mockUser.tenantId,
        name: 'Beta Logistics',
        email: 'beta@logistics.in',
        phone: '+919876543299',
      });

      const csv = `Number,Customer,Amount,IssueDate,DueDate,Description\nINV-BETA-01,beta@logistics.in,45000,2026-09-01,2026-09-30,Freight services`;
      const result = await service.parseAndImportCsv(mockUser, {
        type: 'INVOICES',
        csvContent: csv,
      });

      expect(result.success).toBe(true);
      expect(result.importedInvoices).toBe(1);
      expect(invoices.length).toBe(1);
      expect(invoices[0].number).toBe('INV-BETA-01');
      expect(invoices[0].amount).toBe(45000);
    });
  });

  describe('Onboarding Status & Readiness', () => {
    it('calculates onboarding progress and readiness metrics', async () => {
      // Initially not ready
      const initialStatus = await service.getOnboardingStatus(mockUser);
      expect(initialStatus.isReadyForCollections).toBe(false);
      expect(initialStatus.progressPercentage).toBe(0);

      // Configure company
      await service.saveCompanyProfile(mockUser, {
        companyName: 'Ready Corp',
        gstin: '29ABCDE1234F1Z5',
      });

      // Add customer & invoice
      customers.push({
        id: 'cust_ready',
        tenantId: mockUser.tenantId,
        name: 'Ready Client',
        email: 'ready@client.in',
        phone: '+919876500009',
        outstandingBalance: 60000,
      });

      invoices.push({
        id: 'inv_ready',
        tenantId: mockUser.tenantId,
        customerId: 'cust_ready',
        number: 'INV-READY-001',
        amount: 60000,
        outstanding: 60000,
        status: 'OVERDUE',
        dueDate: new Date('2026-09-30'),
      });

      const updatedStatus = await service.getOnboardingStatus(mockUser);
      expect(updatedStatus.isReadyForCollections).toBe(true);
      expect(updatedStatus.progressPercentage).toBeGreaterThanOrEqual(75);
      expect(updatedStatus.metrics.customerCount).toBe(1);
      expect(updatedStatus.metrics.invoiceCount).toBe(1);
      expect(updatedStatus.metrics.totalOutstandingReceivables).toBe(60000);
    });
  });

  describe('Financial Import Preview & Validation', () => {
    it('provides an accurate preview and calculated balances without writing to DB', async () => {
      const preview = await service.previewFinancialImport(mockUser, {
        customers: [
          {
            name: 'Preview Corp',
            email: 'preview@corp.in',
            phone: '+919876543299',
            openingBalance: 100000,
          },
        ],
        invoices: [
          {
            number: 'INV-PREV-001',
            customerRef: 'preview@corp.in',
            amount: 50000,
            issueDate: '2026-09-01',
            dueDate: '2026-09-30',
          },
        ],
        payments: [
          {
            reference: 'PAY-PREV-001',
            invoiceNumber: 'INV-PREV-001',
            amount: 20000,
            paymentDate: '2026-10-01',
          },
        ],
      });

      expect(preview.isValid).toBe(true);
      expect(preview.summary.totalCustomers).toBe(1);
      expect(preview.summary.totalInvoices).toBe(1);
      expect(preview.summary.totalPayments).toBe(1);
      expect(preview.summary.totalReceivables).toBe(30000);
      expect(preview.invoices[0].calculatedOutstanding).toBe(30000);
      expect(preview.payments[0].data.isPartial).toBe(true);
      expect(preview.payments[0].data.remainingInvoiceBalance).toBe(30000);

      // Verify that NO records were inserted into the mock database arrays
      expect(customers.find((c) => c.email === 'preview@corp.in')).toBeUndefined();
      expect(invoices.find((i) => i.number === 'INV-PREV-001')).toBeUndefined();
    });

    it('detects errors and duplicate references during preview', async () => {
      const preview = await service.previewFinancialImport(mockUser, {
        customers: [
          {
            name: 'Dup Cust 1',
            email: 'dup@cust.in',
            phone: '+919876500010',
          },
          {
            name: 'Dup Cust 2',
            email: 'dup@cust.in',
            phone: '+919876500011',
          },
        ],
        invoices: [
          {
            number: 'INV-DUP-01',
            customerRef: 'nonexistent@customer.in',
            amount: -500,
            issueDate: 'invalid-date',
            dueDate: '2026-10-01',
          },
        ],
      });

      expect(preview.isValid).toBe(false);
      expect(preview.summary.errorCount).toBeGreaterThan(0);
      expect(preview.customers[1].status).toBe('ERROR');
      expect(preview.customers[1].errors.some((e) => e.includes('Duplicate email'))).toBe(true);
      expect(preview.invoices[0].status).toBe('ERROR');
      expect(preview.invoices[0].errors.some((e) => e.includes('not found'))).toBe(true);
    });

    it('previews tab-delimited Excel data accurately', async () => {
      const tsvContent = `Name\tEmail\tPhone\tCompany\nTSV Corp\ttsv@corp.in\t+919876540001\tTSV Industries`;
      const preview = await service.previewCsv(mockUser, {
        type: 'CUSTOMERS',
        csvContent: tsvContent,
      });

      expect(preview.isValid).toBe(true);
      expect(preview.summary.totalCustomers).toBe(1);
      expect(preview.customers[0].data.name).toBe('TSV Corp');
      expect(preview.customers[0].data.email).toBe('tsv@corp.in');
    });
  });

  describe('Onboarding Status & Readiness Progression', () => {
    it('starts at 0% for brand-new empty company and lists all missing steps', async () => {
      const status = await service.getOnboardingStatus(mockUser);

      expect(status.tenantId).toBe(mockUser.tenantId);
      expect(status.completionPercentage).toBe(0);
      expect(status.progressPercentage).toBe(0);
      expect(status.isComplete).toBe(false);
      expect(status.currentStep).toBe('COMPANY_DETAILS');
      expect(status.nextStepTitle).toBe('Setup Company Profile');
      expect(status.missingSteps).toEqual([
        'Company Profile & Tax Registration',
        'Customer Directory',
        'Invoices & Due Dates',
      ]);
      expect(status.counts.customers).toBe(0);
      expect(status.counts.invoices).toBe(0);
      expect(status.counts.payments).toBe(0);
    });

    it('advances to 33% after company profile is saved', async () => {
      await service.saveCompanyProfile(mockUser, {
        legalName: 'Alpha Innovations Pvt Ltd',
        gstin: '27AABCU9603R1ZM',
        pan: 'ABCDE1234F',
        billingAddress: '42 MG Road, Bengaluru',
        phone: '+919876543210',
      });

      const status = await service.getOnboardingStatus(mockUser);

      expect(status.completionPercentage).toBe(33);
      expect(status.isComplete).toBe(false);
      expect(status.currentStep).toBe('CUSTOMERS');
      expect(status.nextStepTitle).toBe('Add or Import Customers');
      expect(status.completedSteps).toContain('COMPANY_DETAILS');
      expect(status.missingSteps).toEqual([
        'Customer Directory',
        'Invoices & Due Dates',
      ]);
    });

    it('advances to 67% after customer directory is populated', async () => {
      // 1. Save company profile
      await service.saveCompanyProfile(mockUser, {
        legalName: 'Alpha Innovations Pvt Ltd',
      });

      // 2. Add customer
      customers.push({
        id: 'cust_001',
        tenantId: mockUser.tenantId,
        name: 'MOHAMMAD MUSTAK',
        email: 'mustak@gmail.com',
        phone: '+919618954429',
        outstandingBalance: 0,
      });

      const status = await service.getOnboardingStatus(mockUser);

      expect(status.completionPercentage).toBe(67);
      expect(status.isComplete).toBe(false);
      expect(status.currentStep).toBe('INVOICES');
      expect(status.nextStepTitle).toBe('Create or Import Invoices');
      expect(status.counts.customers).toBe(1);
      expect(status.missingSteps).toEqual(['Invoices & Due Dates']);
    });

    it('reaches 100% and isComplete=true after invoices are recorded, even with 0 payments (payments optional)', async () => {
      // 1. Save company profile
      await service.saveCompanyProfile(mockUser, {
        legalName: 'Alpha Innovations Pvt Ltd',
      });

      // 2. Add customer
      customers.push({
        id: 'cust_001',
        tenantId: mockUser.tenantId,
        name: 'MOHAMMAD MUSTAK',
        email: 'mustak@gmail.com',
        phone: '+919618954429',
        outstandingBalance: 100000,
      });

      // 3. Add invoice
      invoices.push({
        id: 'inv_001',
        tenantId: mockUser.tenantId,
        customerId: 'cust_001',
        number: 'INV-2026-01',
        amount: 100000,
        outstanding: 100000,
        status: 'OPEN',
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86400000),
      });

      const status = await service.getOnboardingStatus(mockUser);

      expect(status.completionPercentage).toBe(100);
      expect(status.progressPercentage).toBe(100);
      expect(status.isComplete).toBe(true);
      expect(status.isReadyForCollections).toBe(true);
      expect(status.currentStep).toBe('COMPLETE');
      expect(status.nextStepTitle).toBe('Setup Complete');
      expect(status.missingSteps).toEqual([]);
      expect(status.counts.customers).toBe(1);
      expect(status.counts.invoices).toBe(1);
      expect(status.counts.payments).toBe(0); // legitimately 0 payments
    });

    it('reflects payment settlements if recorded while preserving 100% completion', async () => {
      // 1. Profile
      await service.saveCompanyProfile(mockUser, { legalName: 'Alpha Pvt Ltd' });

      // 2. Customer
      customers.push({
        id: 'cust_001',
        tenantId: mockUser.tenantId,
        name: 'MOHAMMAD MUSTAK',
        email: 'mustak@gmail.com',
        phone: '+919618954429',
        outstandingBalance: 75000,
      });

      // 3. Invoice
      invoices.push({
        id: 'inv_001',
        tenantId: mockUser.tenantId,
        customerId: 'cust_001',
        number: 'INV-2026-01',
        amount: 100000,
        outstanding: 75000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86400000),
      });

      // 4. Payment
      payments.push({
        id: 'pay_001',
        tenantId: mockUser.tenantId,
        customerId: 'cust_001',
        invoiceId: 'inv_001',
        amount: 25000,
        reference: 'UTR-998877',
      });

      const status = await service.getOnboardingStatus(mockUser);

      expect(status.completionPercentage).toBe(100);
      expect(status.isComplete).toBe(true);
      expect(status.counts.payments).toBe(1);
      expect(status.completedSteps).toContain('PAYMENTS');
    });

    it('strictly enforces tenant isolation so other tenant records do not affect onboarding status', async () => {
      // Create data for OTHER tenant
      customers.push({
        id: 'cust_other',
        tenantId: 'tenant_other_02',
        name: 'Other Cust',
        email: 'other@cust.in',
        phone: '+919999999999',
      });
      invoices.push({
        id: 'inv_other',
        tenantId: 'tenant_other_02',
        number: 'INV-OTHER-01',
        amount: 50000,
        outstanding: 50000,
        status: 'OPEN',
      });

      // mockUser (tenant_onboard_01) should remain 0%
      const status = await service.getOnboardingStatus(mockUser);

      expect(status.completionPercentage).toBe(0);
      expect(status.isComplete).toBe(false);
      expect(status.counts.customers).toBe(0);
      expect(status.counts.invoices).toBe(0);
    });

    it('persists status accurately across multiple re-queries / simulated refreshes', async () => {
      await service.saveCompanyProfile(mockUser, { legalName: 'Alpha Innovations' });
      customers.push({
        id: 'cust_001',
        tenantId: mockUser.tenantId,
        name: 'Customer 1',
        email: 'cust1@gmail.com',
        phone: '+919618954429',
      });
      invoices.push({
        id: 'inv_001',
        tenantId: mockUser.tenantId,
        number: 'INV-001',
        amount: 50000,
        outstanding: 50000,
        status: 'OPEN',
      });

      // First query (initial load)
      const status1 = await service.getOnboardingStatus(mockUser);
      expect(status1.completionPercentage).toBe(100);
      expect(status1.isComplete).toBe(true);

      // Second query (simulating browser page refresh or re-login)
      const status2 = await service.getOnboardingStatus(mockUser);
      expect(status2.completionPercentage).toBe(100);
      expect(status2.isComplete).toBe(true);
      expect(status2.counts).toEqual(status1.counts);
      expect(status2.missingSteps).toEqual([]);
    });
  });
});
