import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PaymentsService } from './payments.service.js';
import { RazorpayAdapter } from '../integrations/adapters/razorpay.adapter.js';
import { StripeAdapter } from '../integrations/adapters/stripe.adapter.js';
import {
  PaymentStatus,
  InvoiceStatus,
  PaymentMethod,
  OrderIntentStatus,
  RefundStatus,
} from '@prisma/client';

function signRazorpay(body: Record<string, any>, secret: string) {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

function signStripe(body: Record<string, any>, secret: string) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { raw, signature: `t=${timestamp},v1=${sig}` };
}

describe('PaymentsService - Razorpay Security Hardening, Replay & Reconciliation Tests', () => {
  const originalRzpWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalPaymentSim = process.env.PAYMENT_SIMULATION_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  let service: PaymentsService;
  let razorpayAdapter: RazorpayAdapter;
  let stripeAdapter: StripeAdapter;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  let invoices: any[];
  let customers: any[];
  let payments: any[];
  let paymentOrderIntents: any[];
  let paymentRefunds: any[];
  let webhookReplays: any[];
  let collectionCases: any[];
  let followUpTasks: any[];
  let integrationConfigs: Record<string, Record<string, any>>;
  let auditLogs: any[];
  let injectCommitFailure = false;

  const GLOBAL_RZP_SECRET = 'rzp_global_test_webhook_secret_123';
  const GLOBAL_STRIPE_SECRET = 'whsec_global_stripe_secret_123';

  function seedPendingPaymentLink(opts: {
    id?: string;
    tenantId: string;
    invoiceId: string;
    customerId: string;
    providerRef: string;
    amount: number;
    currency?: string;
    status?: PaymentStatus;
  }) {
    const row = {
      id: opts.id || `pay_seed_${payments.length + 1}`,
      ref: `PLINK-SEED-${payments.length + 1}`,
      tenantId: opts.tenantId,
      customerId: opts.customerId,
      invoiceId: opts.invoiceId,
      amount: opts.amount,
      currency: opts.currency || 'INR',
      method: PaymentMethod.PAYMENT_LINK,
      status: opts.status || PaymentStatus.PENDING,
      providerRef: opts.providerRef,
      notes: `https://rzp.io/i/${opts.providerRef} [link:${opts.providerRef}]`,
      createdAt: new Date(),
    };
    payments.push(row);
    return row;
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.PAYMENT_SIMULATION_MODE;
    process.env.RAZORPAY_WEBHOOK_SECRET = GLOBAL_RZP_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = GLOBAL_STRIPE_SECRET;

    customers = [
      {
        id: 'cust_01',
        name: 'Sharma Industries',
        email: 'billing@sharma.in',
        phone: '+919876543210',
        outstandingBalance: 10000,
        tenantId: 'tenant_01',
      },
      {
        id: 'cust_b1',
        name: 'Apex Distributors',
        email: 'ap@apex.in',
        phone: '+919876500001',
        outstandingBalance: 10000,
        tenantId: 'tenant_02',
      },
    ];

    invoices = [
      {
        id: 'inv_01',
        number: 'INV-SHARED-1001',
        amount: 10000,
        outstanding: 10000,
        currency: 'INR',
        status: InvoiceStatus.OPEN,
        customerId: 'cust_01',
        tenantId: 'tenant_01',
      },
      {
        id: 'inv_b1',
        number: 'INV-SHARED-1001',
        amount: 10000,
        outstanding: 10000,
        currency: 'INR',
        status: InvoiceStatus.OPEN,
        customerId: 'cust_b1',
        tenantId: 'tenant_02',
      },
    ];

    payments = [];
    paymentOrderIntents = [];
    paymentRefunds = [];
    webhookReplays = [];
    collectionCases = [];
    followUpTasks = [];
    integrationConfigs = {};
    auditLogs = [];
    injectCommitFailure = false;

    const matchPaymentCondition = (p: any, cond: any): boolean => {
      if (cond.id && p.id !== cond.id) return false;
      if (cond.providerRef && p.providerRef !== cond.providerRef) return false;
      if (cond.method && p.method !== cond.method) return false;
      if (cond.status) {
        if (typeof cond.status === 'string' && p.status !== cond.status) return false;
        if (cond.status?.in && !cond.status.in.includes(p.status)) return false;
      }
      if (cond.ref) {
        if (typeof cond.ref === 'string' && p.ref !== cond.ref) return false;
        if (cond.ref?.startsWith && (!p.ref || !p.ref.startsWith(cond.ref.startsWith))) return false;
      }
      if (cond.notes?.contains && (!p.notes || !p.notes.includes(cond.notes.contains))) {
        return false;
      }
      return true;
    };

    const matchWherePayments = (list: any[], where: any = {}, orderBy?: any) => {
      const filtered = list.filter((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.tenantId && p.tenantId !== where.tenantId) return false;
        if (where.invoiceId && p.invoiceId !== where.invoiceId) return false;
        if (where.status) {
          if (typeof where.status === 'string' && p.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(p.status)) return false;
        }
        if (where.providerRef && p.providerRef !== where.providerRef) return false;
        if (where.ref) {
          if (typeof where.ref === 'string' && p.ref !== where.ref) return false;
          if (where.ref?.startsWith && (!p.ref || !p.ref.startsWith(where.ref.startsWith))) return false;
        }
        if (where.OR) {
          return where.OR.some((cond: any) => matchPaymentCondition(p, cond));
        }
        return true;
      });
      if (orderBy?.createdAt === 'desc') {
        return [...filtered].sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        );
      }
      return filtered;
    };

    const matchWhereIntents = (list: any[], where: any = {}, orderBy?: any) => {
      const matchCond = (item: any, cond: any): boolean => {
        if (cond.id && item.id !== cond.id) return false;
        if (cond.idempotencyKey && item.idempotencyKey !== cond.idempotencyKey) return false;
        if (cond.activeClaimKey && item.activeClaimKey !== cond.activeClaimKey) return false;
        if (cond.providerOrderId && item.providerOrderId !== cond.providerOrderId) return false;
        if (cond.paymentId && item.paymentId !== cond.paymentId) return false;
        if (cond.receipt && item.receipt !== cond.receipt) return false;
        return true;
      };
      const filtered = list.filter((item) => {
        if (where.id && item.id !== where.id) return false;
        if (where.tenantId && item.tenantId !== where.tenantId) return false;
        if (where.invoiceId && item.invoiceId !== where.invoiceId) return false;
        if (where.providerOrderId && item.providerOrderId !== where.providerOrderId) return false;
        if (where.idempotencyKey && item.idempotencyKey !== where.idempotencyKey) return false;
        if (where.activeClaimKey && item.activeClaimKey !== where.activeClaimKey) return false;
        if (where.status) {
          if (typeof where.status === 'string' && item.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(item.status)) return false;
        }
        if (where.OR) {
          return where.OR.some((c: any) => matchCond(item, c));
        }
        return true;
      });
      if (orderBy?.createdAt === 'desc') {
        return [...filtered].sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        );
      }
      return filtered;
    };

    const matchWhereRefunds = (list: any[], where: any = {}) =>
      list.filter((r) => {
        if (where.id && r.id !== where.id) return false;
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.paymentId && r.paymentId !== where.paymentId) return false;
        if (where.invoiceId && r.invoiceId !== where.invoiceId) return false;
        if (where.providerRefundId && r.providerRefundId !== where.providerRefundId) return false;
        if (where.providerPaymentId && r.providerPaymentId !== where.providerPaymentId) return false;
        if (where.status && r.status !== where.status) return false;
        return true;
      });

    const filterPayments = (where: any = {}, orderBy?: any) =>
      matchWherePayments(payments, where, orderBy);

    // Per-row async mutex queue modeling PostgreSQL Customer -> Invoice FOR UPDATE row locking
    const rowLocks = new Map<string, Promise<void>>();
    const pendingReplayKeys = new Set<string>();

    const acquireRowLock = async (lockKey: string): Promise<() => void> => {
      while (rowLocks.has(lockKey)) {
        await rowLocks.get(lockKey);
      }
      let release!: () => void;
      const promise = new Promise<void>((res) => {
        release = res;
      });
      rowLocks.set(lockKey, promise);
      return () => {
        if (rowLocks.get(lockKey) === promise) {
          rowLocks.delete(lockKey);
        }
        release();
      };
    };

    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        // Model PostgreSQL READ COMMITTED snapshot + dirty write buffer + FOR UPDATE refresh
        const heldReleases: Array<() => void> = [];
        const deletedReplays = new Set<string>();
        const txAddedReplays: any[] = [];
        const dirtyInvoices = new Map<string, any>();
        const dirtyCustomers = new Map<string, any>();
        const dirtyPayments = new Map<string, any>();
        const dirtyRefunds = new Map<string, any>();
        const dirtyIntents = new Map<string, any>();
        const dirtyCases = new Map<string, any>();

        const mergeTable = (base: any[], dirty: Map<string, any>) => {
          const map = new Map<string, any>(base.map((row) => [row.id, { ...row }]));
          for (const [id, row] of dirty.entries()) {
            map.set(id, { ...row });
          }
          return Array.from(map.values());
        };

        const tx = {
          $queryRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
            const sqlText = Array.isArray(strings) ? strings.join(' ') : String(strings || '');
            const entity = sqlText.includes('"Customer"')
              ? 'Customer'
              : sqlText.includes('"Invoice"')
                ? 'Invoice'
                : 'Row';
            const rowId = values?.[0] ? String(values[0]) : 'global';
            const release = await acquireRowLock(`${entity}:${rowId}`);
            heldReleases.push(release);
            // Force yield so concurrent tx interleaves realistically around lock
            await Promise.resolve();
            return [{ id: rowId }];
          }),
          webhookReplay: {
            deleteMany: vi.fn().mockImplementation(async ({ where }) => {
              let count = 0;
              for (const r of webhookReplays) {
                if (deletedReplays.has(r.replayKey)) continue;
                const keyMatch = !where?.replayKey || r.replayKey === where.replayKey;
                const expMatch = !where?.expiresAt?.lte || r.expiresAt <= where.expiresAt.lte;
                if (keyMatch && expMatch) {
                  deletedReplays.add(r.replayKey);
                  count++;
                }
              }
              return { count };
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const activeExisting = webhookReplays.some(
                (r) => r.replayKey === data.replayKey && !deletedReplays.has(r.replayKey),
              );
              if (activeExisting || pendingReplayKeys.has(data.replayKey)) {
                const err: any = new Error('Unique constraint failed on the fields: (replayKey)');
                err.code = 'P2002';
                throw err;
              }
              pendingReplayKeys.add(data.replayKey);
              const rec = { id: `whr_${Date.now()}_${txAddedReplays.length + 1}`, ...data };
              txAddedReplays.push(rec);
              return rec;
            }),
          },
          invoice: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              const currentInvoices = mergeTable(invoices, dirtyInvoices);
              const currentCustomers = mergeTable(customers, dirtyCustomers);
              const found = currentInvoices.find((inv) => {
                if (where?.id && inv.id !== where.id) return false;
                if (where?.tenantId && inv.tenantId !== where.tenantId) return false;
                if (where?.number && inv.number !== where.number) return false;
                return true;
              });
              if (!found) return null;
              const customer = currentCustomers.find((c) => c.id === found.customerId) || null;
              return { ...found, customer, tenant: { id: found.tenantId } };
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return mergeTable(invoices, dirtyInvoices)
                .filter((inv) => {
                  if (where?.customerId && inv.customerId !== where.customerId) return false;
                  if (where?.tenantId && inv.tenantId !== where.tenantId) return false;
                  if (where?.status?.in && !where.status.in.includes(inv.status)) return false;
                  return true;
                })
                .map((inv) => ({ ...inv }));
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const base =
                dirtyInvoices.get(where.id) || invoices.find((item) => item.id === where.id);
              if (!base) return null;
              const updated = { ...base, ...data };
              dirtyInvoices.set(where.id, updated);
              return { ...updated };
            }),
          },
          customer: {
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              if (injectCommitFailure) {
                throw new Error('DB transient failure during commit');
              }
              const base =
                dirtyCustomers.get(where.id) || customers.find((c) => c.id === where.id);
              if (!base) return null;
              const updated = { ...base, ...data };
              dirtyCustomers.set(where.id, updated);
              return { ...updated };
            }),
          },
          collectionCase: {
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              let count = 0;
              for (const cc of mergeTable(collectionCases, dirtyCases)) {
                if (where?.tenantId && cc.tenantId !== where.tenantId) continue;
                if (where?.invoiceId && cc.invoiceId !== where.invoiceId) continue;
                if (where?.status) {
                  if (typeof where.status === 'string' && cc.status !== where.status) continue;
                  if (where.status?.in && !where.status.in.includes(cc.status)) continue;
                }
                const updated = { ...cc, ...data };
                dirtyCases.set(cc.id, updated);
                count++;
              }
              return { count };
            }),
          },
          payment: {
            findMany: vi.fn().mockImplementation(async ({ where, orderBy }) => {
              return matchWherePayments(mergeTable(payments, dirtyPayments), where, orderBy);
            }),
            findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
              const list = matchWherePayments(mergeTable(payments, dirtyPayments), where, orderBy);
              return list[0] || null;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const base =
                dirtyPayments.get(where.id) || payments.find((item) => item.id === where.id);
              if (!base) return null;
              const updated = { ...base, ...data };
              dirtyPayments.set(where.id, updated);
              return { ...updated };
            }),
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              let count = 0;
              for (const p of mergeTable(payments, dirtyPayments)) {
                if (where?.tenantId && p.tenantId !== where.tenantId) continue;
                if (where?.invoiceId && p.invoiceId !== where.invoiceId) continue;
                if (where?.providerRef && p.providerRef !== where.providerRef) continue;
                if (where?.status && p.status !== where.status) continue;
                dirtyPayments.set(p.id, { ...p, ...data });
                count++;
              }
              return { count };
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const current = mergeTable(payments, dirtyPayments);
              if (current.some((p) => p.ref === data.ref)) {
                const err: any = new Error('Unique constraint failed on the fields: (ref)');
                err.code = 'P2002';
                throw err;
              }
              const newPayment = {
                id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                createdAt: data.createdAt || new Date(),
                ...data,
              };
              dirtyPayments.set(newPayment.id, newPayment);
              return { ...newPayment };
            }),
          },
          paymentRefund: {
            findFirst: vi.fn().mockImplementation(async ({ where }) => {
              const list = matchWhereRefunds(mergeTable(paymentRefunds, dirtyRefunds), where);
              return list[0] || null;
            }),
            findMany: vi.fn().mockImplementation(async ({ where }) => {
              return matchWhereRefunds(mergeTable(paymentRefunds, dirtyRefunds), where);
            }),
            create: vi.fn().mockImplementation(async ({ data }) => {
              const current = mergeTable(paymentRefunds, dirtyRefunds);
              if (current.some((r) => r.providerRefundId === data.providerRefundId)) {
                const err: any = new Error(
                  'Unique constraint failed on the fields: (providerRefundId)',
                );
                err.code = 'P2002';
                throw err;
              }
              const row = {
                id: `rfndrow_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
              };
              dirtyRefunds.set(row.id, row);
              return { ...row };
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const base =
                dirtyRefunds.get(where.id) || paymentRefunds.find((r) => r.id === where.id);
              if (!base) return null;
              const updated = { ...base, ...data, updatedAt: new Date() };
              dirtyRefunds.set(where.id, updated);
              return { ...updated };
            }),
          },
          paymentOrderIntent: {
            findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
              const list = matchWhereIntents(
                mergeTable(paymentOrderIntents, dirtyIntents),
                where,
                orderBy,
              );
              return list[0] || null;
            }),
            update: vi.fn().mockImplementation(async ({ where, data }) => {
              const base =
                dirtyIntents.get(where.id) ||
                paymentOrderIntents.find((i) => i.id === where.id);
              if (!base) return null;
              const updated = { ...base, ...data, updatedAt: new Date() };
              dirtyIntents.set(where.id, updated);
              return { ...updated };
            }),
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              const list = matchWhereIntents(mergeTable(paymentOrderIntents, dirtyIntents), where);
              for (const item of list) {
                dirtyIntents.set(item.id, { ...item, ...data, updatedAt: new Date() });
              }
              return { count: list.length };
            }),
          },
          user: {
            findFirst: vi.fn().mockResolvedValue({ id: 'user_admin_01', role: 'ADMIN' }),
          },
        };

        try {
          const result = await cb(tx);
          // Commit dirty changes atomically into shared stores
          invoices = mergeTable(invoices, dirtyInvoices);
          customers = mergeTable(customers, dirtyCustomers);
          payments = mergeTable(payments, dirtyPayments);
          paymentRefunds = mergeTable(paymentRefunds, dirtyRefunds);
          paymentOrderIntents = mergeTable(paymentOrderIntents, dirtyIntents);
          collectionCases = mergeTable(collectionCases, dirtyCases);
          webhookReplays = webhookReplays
            .filter((r) => !deletedReplays.has(r.replayKey))
            .concat(txAddedReplays);
          return result;
        } finally {
          for (const rec of txAddedReplays) {
            pendingReplayKeys.delete(rec.replayKey);
          }
          for (const release of heldReleases.reverse()) {
            release();
          }
        }
      }),
      webhookReplay: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      invoice: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          const inv = invoices.find((item) => {
            if (where?.id && item.id !== where.id) return false;
            if (where?.tenantId && item.tenantId !== where.tenantId) return false;
            return true;
          });
          if (!inv) return null;
          const customer = customers.find((c) => c.id === inv.customerId) || null;
          return { ...inv, customer };
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return invoices.filter((item) => {
            if (where?.customerId && item.customerId !== where.customerId) return false;
            if (where?.tenantId && item.tenantId !== where.tenantId) return false;
            if (where?.status?.in && !where.status.in.includes(item.status)) return false;
            return true;
          });
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const inv = invoices.find((item) => item.id === where.id);
          if (inv) Object.assign(inv, data);
          return inv ? { ...inv } : null;
        }),
      },
      customer: {
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const c = customers.find((item) => item.id === where.id);
          if (c) Object.assign(c, data);
          return c ? { ...c } : null;
        }),
      },
      collectionCase: {
        findMany: vi.fn().mockImplementation(async ({ where }) =>
          collectionCases.filter(
            (cc) => cc.tenantId === where?.tenantId && cc.assignedTo === where?.assignedTo,
          ),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      followUpTask: {
        findMany: vi.fn().mockImplementation(async ({ where }) =>
          followUpTasks.filter(
            (t) => t.tenantId === where?.tenantId && t.assignedTo === where?.assignedTo,
          ),
        ),
      },
      paymentOrderIntent: {
        findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
          const list = matchWhereIntents(paymentOrderIntents, where, orderBy);
          return list[0] ? { ...list[0] } : null;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          if (paymentOrderIntents.some((i) => i.idempotencyKey === data.idempotencyKey)) {
            const err: any = new Error('Unique constraint failed on the fields: (idempotencyKey)');
            err.code = 'P2002';
            throw err;
          }
          if (
            data.activeClaimKey &&
            paymentOrderIntents.some((i) => i.activeClaimKey === data.activeClaimKey)
          ) {
            const err: any = new Error('Unique constraint failed on the fields: (activeClaimKey)');
            err.code = 'P2002';
            throw err;
          }
          if (paymentOrderIntents.some((i) => i.receipt === data.receipt)) {
            const err: any = new Error('Unique constraint failed on the fields: (receipt)');
            err.code = 'P2002';
            throw err;
          }
          const row = {
            id: `intent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          paymentOrderIntents.push(row);
          return { ...row };
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const idx = paymentOrderIntents.findIndex((i) => i.id === where.id);
          if (idx < 0) return null;
          paymentOrderIntents[idx] = {
            ...paymentOrderIntents[idx],
            ...data,
            updatedAt: new Date(),
          };
          return { ...paymentOrderIntents[idx] };
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          const matched = matchWhereIntents(paymentOrderIntents, where);
          for (const m of matched) {
            const idx = paymentOrderIntents.findIndex((i) => i.id === m.id);
            if (idx >= 0) {
              paymentOrderIntents[idx] = {
                ...paymentOrderIntents[idx],
                ...data,
                updatedAt: new Date(),
              };
            }
          }
          return { count: matched.length };
        }),
      },
      paymentRefund: {
        findFirst: vi.fn().mockImplementation(async ({ where, include }) => {
          const list = matchWhereRefunds(paymentRefunds, where);
          const match = list[0];
          if (!match) return null;
          if (include?.payment) {
            const payment = payments.find((p) => p.id === match.paymentId) || null;
            return { ...match, payment };
          }
          return { ...match };
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return matchWhereRefunds(paymentRefunds, where);
        }),
      },
      payment: {
        findMany: vi.fn().mockImplementation(async ({ where, orderBy }) => filterPayments(where, orderBy)),
        findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
          const list = filterPayments(where, orderBy);
          const match = list[0];
          if (!match) return null;
          const invoice = invoices.find((inv) => inv.id === match.invoiceId);
          return { ...match, invoice };
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          if (payments.some((p) => p.ref === data.ref)) {
            const err: any = new Error('Unique constraint failed on the fields: (ref)');
            err.code = 'P2002';
            throw err;
          }
          const row = {
            id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            createdAt: data.createdAt || new Date(),
            ...data,
          };
          payments.push(row);
          return row;
        }),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockImplementation(async (entry) => {
        auditLogs.push(entry);
        return entry;
      }),
    };

    razorpayAdapter = new RazorpayAdapter();
    stripeAdapter = new StripeAdapter();
    mockIntegrations = {
      razorpay: razorpayAdapter,
      stripe: stripeAdapter,
      getRawConfig: vi.fn().mockImplementation(async (tenantId: string, provider: string) => {
        return integrationConfigs[`${tenantId}:${provider.toUpperCase()}`] || {};
      }),
    };

    service = new PaymentsService(mockPrisma, mockAuditLogs, mockIntegrations);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    if (originalRzpWebhookSecret !== undefined) {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalRzpWebhookSecret;
    } else {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    }
    if (originalStripeWebhookSecret !== undefined) {
      process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
    } else {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
    if (originalPaymentSim !== undefined) {
      process.env.PAYMENT_SIMULATION_MODE = originalPaymentSim;
    } else {
      delete process.env.PAYMENT_SIMULATION_MODE;
    }
  });

  it('1. reconciles the exact tenant when two tenants share identical invoice numbers', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_02',
      invoiceId: 'inv_b1',
      customerId: 'cust_b1',
      providerRef: 'plink_tenant_b_001',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_rzp_b_001', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_tenant_b_001', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw, signature } = signRazorpay(payload, GLOBAL_RZP_SECRET);

    const res = await service.handleWebhook(
      'razorpay',
      payload,
      { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_shared_01' },
      raw,
    );

    expect(res.processed).toBe(true);
    expect(invoices.find((i) => i.id === 'inv_b1').status).toBe(InvoiceStatus.PAID);
    expect(invoices.find((i) => i.id === 'inv_b1').outstanding).toBe(0);
    expect(customers.find((c) => c.id === 'cust_b1').outstandingBalance).toBe(0);

    // Tenant A's identically numbered invoice must remain untouched
    expect(invoices.find((i) => i.id === 'inv_01').status).toBe(InvoiceStatus.OPEN);
    expect(invoices.find((i) => i.id === 'inv_01').outstanding).toBe(10000);
    expect(customers.find((c) => c.id === 'cust_01').outstandingBalance).toBe(10000);
  });

  it('2. rejects unscoped or cross-tenant webhooks without altering financial records', async () => {
    // 2a. Unscoped invoice-number-only webhook (no matching stored payment anchor) must fail closed
    const unscopedPayload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_unscoped_01', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_unknown_999', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw: raw1, signature: sig1 } = signRazorpay(unscopedPayload, GLOBAL_RZP_SECRET);

    await expect(
      service.handleWebhook(
        'razorpay',
        unscopedPayload,
        { 'x-razorpay-signature': sig1, 'x-razorpay-event-id': 'evt_unscoped_1' },
        raw1,
      ),
    ).rejects.toThrow(BadRequestException);

    // 2b. Cross-tenant relation tampering inside payment record must fail closed
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_b1', // mismatched tenant_02 invoice attached to tenant_01 payment
      customerId: 'cust_01',
      providerRef: 'plink_cross_tenant',
      amount: 10000,
    });
    const crossPayload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_cross_01', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_cross_tenant', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw: raw2, signature: sig2 } = signRazorpay(crossPayload, GLOBAL_RZP_SECRET);

    await expect(
      service.handleWebhook(
        'razorpay',
        crossPayload,
        { 'x-razorpay-signature': sig2, 'x-razorpay-event-id': 'evt_cross_1' },
        raw2,
      ),
    ).rejects.toThrow('Associated invoice not found in tenant');

    expect(invoices[0].outstanding).toBe(10000);
    expect(invoices[1].outstanding).toBe(10000);
    expect(webhookReplays).toHaveLength(0);
  });

  it('3. selects tenant IntegrationConfig webhook secret when present and rejects global secret mismatches', async () => {
    const TENANT_A_SECRET = 'tenant_a_specific_wh_secret_789';
    integrationConfigs['tenant_01:RAZORPAY'] = {
      keyId: 'rzp_test_tenantA_123456',
      keySecret: 'secret_tenantA_123456',
      webhookSecret: TENANT_A_SECRET,
    };
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_tenant_a_secret',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_tenant_a_01', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_tenant_a_secret', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };

    // Signed with global secret MUST fail when tenant_01 has its own webhookSecret
    const globalSigned = signRazorpay(payload, GLOBAL_RZP_SECRET);
    await expect(
      service.handleWebhook(
        'razorpay',
        payload,
        { 'x-razorpay-signature': globalSigned.signature, 'x-razorpay-event-id': 'evt_sec_bad' },
        globalSigned.raw,
      ),
    ).rejects.toThrow('Invalid webhook signature');

    // Signed with Tenant A's secret succeeds
    const tenantSigned = signRazorpay(payload, TENANT_A_SECRET);
    const res = await service.handleWebhook(
      'razorpay',
      payload,
      { 'x-razorpay-signature': tenantSigned.signature, 'x-razorpay-event-id': 'evt_sec_ok' },
      tenantSigned.raw,
    );
    expect(res.processed).toBe(true);
    expect(invoices.find((i) => i.id === 'inv_01').outstanding).toBe(0);
  });

  it('4. rejects invalid webhook signature before DB transaction or replay write', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_bad_sig',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_forged', amount: 1000000, currency: 'INR' } },
        payment_link: { entity: { id: 'plink_bad_sig', notes: { invoiceNumber: 'INV-SHARED-1001' } } },
      },
    };

    await expect(
      service.handleWebhook(
        'razorpay',
        payload,
        { 'x-razorpay-signature': 'forged_sig_hex', 'x-razorpay-event-id': 'evt_forged_1' },
        JSON.stringify(payload),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(webhookReplays).toHaveLength(0);
    expect(invoices[0].outstanding).toBe(10000);
  });

  it('5. rejects webhooks when webhook secret is missing or placeholder in non-simulation mode', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_missing_sec',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_missing_sec', amount: 1000000, currency: 'INR' } },
        payment_link: { entity: { id: 'plink_missing_sec', notes: { invoiceNumber: 'INV-SHARED-1001' } } },
      },
    };

    await expect(
      service.handleWebhook(
        'razorpay',
        payload,
        { 'x-razorpay-signature': 'mock_valid_signature', 'x-razorpay-event-id': 'evt_missing_sec' },
        JSON.stringify(payload),
      ),
    ).rejects.toThrow('Webhook secret is not configured');

    process.env.RAZORPAY_WEBHOOK_SECRET = 'placeholder_razorpay_webhook_secret';
    const { raw, signature } = signRazorpay(payload, 'placeholder_razorpay_webhook_secret');
    await expect(
      service.handleWebhook(
        'razorpay',
        payload,
        { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_placeholder_sec' },
        raw,
      ),
    ).rejects.toThrow('Webhook secret is not configured');
  });

  it('6. deduplicates identical x-razorpay-event-id via persistent WebhookReplay table', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_evt_dedupe',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_evt_001', amount: 400000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_evt_dedupe', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw, signature } = signRazorpay(payload, GLOBAL_RZP_SECRET);

    const first = await service.handleWebhook(
      'razorpay',
      payload,
      { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_rzp_dup_001' },
      raw,
    );
    expect(first.idempotent).toBe(false);
    expect(invoices[0].outstanding).toBe(6000);
    expect(webhookReplays).toHaveLength(1);
    expect(webhookReplays[0].replayKey).toBe('razorpay:event:evt_rzp_dup_001');

    const second = await service.handleWebhook(
      'razorpay',
      payload,
      { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_rzp_dup_001' },
      raw,
    );
    expect(second.idempotent).toBe(true);
    expect(invoices[0].outstanding).toBe(6000);
    expect(customers[0].outstandingBalance).toBe(6000);
  });

  it('7. deduplicates duplicate failed webhooks and keeps link anchor available for retry payment', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_fail_retry',
      amount: 10000,
    });

    const failedPayload = {
      event: 'payment.failed',
      payload: {
        payment: { entity: { id: 'pay_failed_attempt_1', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_fail_retry', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw: fRaw, signature: fSig } = signRazorpay(failedPayload, GLOBAL_RZP_SECRET);

    const f1 = await service.handleWebhook(
      'razorpay',
      failedPayload,
      { 'x-razorpay-signature': fSig, 'x-razorpay-event-id': 'evt_fail_1' },
      fRaw,
    );
    expect(f1.status).toBe('FAILED');
    expect(f1.idempotent).toBe(false);

    // Same event ID -> blocked by WebhookReplay
    const f2 = await service.handleWebhook(
      'razorpay',
      failedPayload,
      { 'x-razorpay-signature': fSig, 'x-razorpay-event-id': 'evt_fail_1' },
      fRaw,
    );
    expect(f2.idempotent).toBe(true);

    // Different event ID for the same failed attempt ID -> deduplicated cleanly with zero extra FAILED rows
    const f3 = await service.handleWebhook(
      'razorpay',
      failedPayload,
      { 'x-razorpay-signature': fSig, 'x-razorpay-event-id': 'evt_fail_2' },
      fRaw,
    );
    expect(f3.idempotent).toBe(true);
    expect(payments.filter((p) => p.status === PaymentStatus.FAILED)).toHaveLength(1);
    expect(invoices[0].outstanding).toBe(10000);

    // Later retry payment on the same payment link succeeds cleanly
    const retrySuccessPayload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_retry_ok_2', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_fail_retry', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw: sRaw, signature: sSig } = signRazorpay(retrySuccessPayload, GLOBAL_RZP_SECRET);
    const okRes = await service.handleWebhook(
      'razorpay',
      retrySuccessPayload,
      { 'x-razorpay-signature': sSig, 'x-razorpay-event-id': 'evt_retry_ok_2' },
      sRaw,
    );
    expect(okRes.idempotent).toBe(false);
    expect(okRes.invoiceStatus).toBe(InvoiceStatus.PAID);
    expect(invoices[0].outstanding).toBe(0);
  });

  it('8. rolls back WebhookReplay claim when reconciliation throws and allows legitimate retry', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_rollback_retry',
      amount: 10000,
    });

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_rb_01', amount: 1000000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_rollback_retry', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const { raw, signature } = signRazorpay(payload, GLOBAL_RZP_SECRET);

    // Simulate failure inside transaction AFTER claimWebhookReplayKey ran
    injectCommitFailure = true;

    await expect(
      service.handleWebhook(
        'razorpay',
        payload,
        { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_transient_fail' },
        raw,
      ),
    ).rejects.toThrow('DB transient failure during commit');

    // Replay row and audit log MUST NOT persist after rollback
    expect(webhookReplays).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
    expect(invoices[0].outstanding).toBe(10000);

    // Retry with the exact same event ID succeeds cleanly
    injectCommitFailure = false;
    const retryRes = await service.handleWebhook(
      'razorpay',
      payload,
      { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_transient_fail' },
      raw,
    );
    expect(retryRes.processed).toBe(true);
    expect(retryRes.idempotent).toBe(false);
    expect(invoices[0].outstanding).toBe(0);
    expect(webhookReplays).toHaveLength(1);
    expect(auditLogs).toHaveLength(1);
  });

  it('9. processes multiple partial payments on the same payment link and cross-event deduplicates captured webhooks', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_shared_partial',
      amount: 10000,
    });

    const p1 = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_part_alpha', amount: 300000, currency: 'INR' } },
        payment_link: { entity: { id: 'plink_shared_partial', notes: { invoiceNumber: 'INV-SHARED-1001' } } },
      },
    };
    const s1 = signRazorpay(p1, GLOBAL_RZP_SECRET);
    const res1 = await service.handleWebhook(
      'razorpay',
      p1,
      { 'x-razorpay-signature': s1.signature, 'x-razorpay-event-id': 'evt_p1' },
      s1.raw,
    );
    expect(res1.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(invoices[0].outstanding).toBe(7000);

    // Second distinct partial payment on the same link
    const p2 = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_part_beta', amount: 400000, currency: 'INR' } },
        payment_link: { entity: { id: 'plink_shared_partial', notes: { invoiceNumber: 'INV-SHARED-1001' } } },
      },
    };
    const s2 = signRazorpay(p2, GLOBAL_RZP_SECRET);
    const res2 = await service.handleWebhook(
      'razorpay',
      p2,
      { 'x-razorpay-signature': s2.signature, 'x-razorpay-event-id': 'evt_p2' },
      s2.raw,
    );
    expect(res2.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(invoices[0].outstanding).toBe(3000);
    expect(payments.filter((p) => p.status === PaymentStatus.COMPLETED)).toHaveLength(2);

    // Cross-event payment.captured with same providerPaymentId but new event ID must be idempotent
    const captured = {
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_part_beta', amount: 400000, currency: 'INR' } },
        payment_link: { entity: { id: 'plink_shared_partial', notes: { invoiceNumber: 'INV-SHARED-1001' } } },
      },
    };
    const s3 = signRazorpay(captured, GLOBAL_RZP_SECRET);
    const res3 = await service.handleWebhook(
      'razorpay',
      captured,
      { 'x-razorpay-signature': s3.signature, 'x-razorpay-event-id': 'evt_p2_captured' },
      s3.raw,
    );
    expect(res3.idempotent).toBe(true);
    expect(invoices[0].outstanding).toBe(3000);
  });

  it('10. enforces AGENT customer-assignment authorization on POST /payments/link', async () => {
    const agentUser: any = { userId: 'agent_1', tenantId: 'tenant_01', role: 'AGENT' };

    // Unassigned AGENT is denied
    await expect(
      service.createPaymentLink(agentUser, {
        invoiceId: 'inv_01',
        provider: 'RAZORPAY',
        simulate: true,
      }),
    ).rejects.toThrow(ForbiddenException);

    // Assigned via CollectionCase succeeds cleanly
    collectionCases.push({
      id: 'case_1',
      tenantId: 'tenant_01',
      customerId: 'cust_01',
      assignedTo: 'agent_1',
    });

    const link = await service.createPaymentLink(agentUser, {
      invoiceId: 'inv_01',
      provider: 'RAZORPAY',
      simulate: true,
    });
    expect(link.paymentLinkId).toMatch(/^plink_sim_/);
    expect(payments).toHaveLength(1);
    expect(payments[0].notes).toContain(`[link:${link.paymentLinkId}]`);
  });

  it('11. rejects webhook currency mismatch and tracks overpayments without corrupting balances', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'plink_curr_mismatch',
      amount: 10000,
      currency: 'INR',
    });

    const mismatchPayload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_usd_bad', amount: 1000000, currency: 'USD' } },
        payment_link: {
          entity: { id: 'plink_curr_mismatch', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const sBad = signRazorpay(mismatchPayload, GLOBAL_RZP_SECRET);
    await expect(
      service.handleWebhook(
        'razorpay',
        mismatchPayload,
        { 'x-razorpay-signature': sBad.signature, 'x-razorpay-event-id': 'evt_curr_bad' },
        sBad.raw,
      ),
    ).rejects.toThrow('Webhook currency mismatch');
    expect(invoices[0].outstanding).toBe(10000);
    expect(webhookReplays).toHaveLength(0);

    // Overpayment handling: 15,000 paid against 10,000 outstanding
    const overpayPayload = {
      event: 'payment_link.paid',
      payload: {
        payment: { entity: { id: 'pay_overpay_1', amount: 1500000, currency: 'INR' } },
        payment_link: {
          entity: { id: 'plink_curr_mismatch', notes: { invoiceNumber: 'INV-SHARED-1001' } },
        },
      },
    };
    const sOver = signRazorpay(overpayPayload, GLOBAL_RZP_SECRET);
    const overRes = await service.handleWebhook(
      'razorpay',
      overpayPayload,
      { 'x-razorpay-signature': sOver.signature, 'x-razorpay-event-id': 'evt_overpay_1' },
      sOver.raw,
    );

    expect(overRes.overpaymentDetected).toBe(true);
    expect(overRes.overpaymentAmount).toBe(5000);
    expect(overRes.invoiceStatus).toBe(InvoiceStatus.PAID);
    expect(invoices[0].outstanding).toBe(0);
    expect(customers[0].outstandingBalance).toBe(0);
    expect(payments[0].amount).toBe(15000);
    expect(payments[0].notes).toContain('[OVERPAYMENT:5000]');
    expect(auditLogs.some((a) => a.action === 'payment.overpayment_received_via_webhook')).toBe(
      true,
    );
  });

  it('12. preserves Stripe webhook rawBody verification and partial reconciliation', async () => {
    seedPendingPaymentLink({
      tenantId: 'tenant_01',
      invoiceId: 'inv_01',
      customerId: 'cust_01',
      providerRef: 'cs_stripe_555',
      amount: 10000,
    });

    const stripePayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_stripe_555',
          payment_intent: 'pi_stripe_partial_555',
          amount_total: 350000,
          currency: 'inr',
          metadata: { invoiceNumber: 'INV-SHARED-1001' },
        },
      },
    };
    const { raw, signature } = signStripe(stripePayload, GLOBAL_STRIPE_SECRET);

    const res = await service.handleWebhook(
      'stripe',
      stripePayload,
      { 'stripe-signature': signature },
      raw,
    );

    expect(res.processed).toBe(true);
    expect(res.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(invoices[0].outstanding).toBe(6500);
    expect(customers[0].outstandingBalance).toBe(6500);
  });

  it('13. handles manual settlements and blocks reserved system reference prefixes', async () => {
    const adminUser: any = { userId: 'usr_admin', tenantId: 'tenant_01', role: 'ADMIN' };

    await expect(
      service.recordPayment(adminUser, {
        invoiceId: 'inv_01',
        amount: 1000,
        paymentDate: '2026-11-12',
        reference: 'PAY-WH-SPOOFED',
      }),
    ).rejects.toThrow('reserved system prefix');

    const res = await service.recordPayment(adminUser, {
      invoiceId: 'inv_01',
      amount: 4000,
      paymentDate: '2026-11-12',
      reference: 'PAY-MANUAL-001',
      method: PaymentMethod.BANK_TRANSFER,
    });
    expect(res.success).toBe(true);
    expect(res.remainingOutstanding).toBe(6000);
    expect(res.newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  describe('Phase 2 — Razorpay Orders API & Standard Checkout Signature Verification', () => {
    const TENANT_KEY_ID = 'rzp_test_tenant01_pub';
    const TENANT_KEY_SECRET = 'rzp_test_tenant01_priv_secret_999';
    const TENANT_WEBHOOK_SECRET = 'rzp_whsec_tenant01_999';
    const adminUser: any = { userId: 'usr_admin_01', tenantId: 'tenant_01', role: 'ADMIN' };
    const agentUser: any = { userId: 'usr_agent_01', tenantId: 'tenant_01', role: 'AGENT' };
    const otherTenantUser: any = { userId: 'usr_admin_02', tenantId: 'tenant_02', role: 'ADMIN' };

    function configureTenant01Razorpay() {
      integrationConfigs['tenant_01:RAZORPAY'] = {
        keyId: TENANT_KEY_ID,
        keySecret: TENANT_KEY_SECRET,
        webhookSecret: TENANT_WEBHOOK_SECRET,
      };
    }

    function signCheckout(orderId: string, paymentId: string, secret = TENANT_KEY_SECRET) {
      return crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    }

    function mockRazorpayFetchOrderAndPayment(opts: {
      orderId?: string;
      orderAmountPaise?: number;
      orderCurrency?: string;
      paymentId?: string;
      paymentOrderId?: string | null;
      paymentAmountPaise?: number;
      paymentCurrency?: string;
      paymentStatus?: string;
      paymentMethod?: string;
    }) {
      return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          return {
            ok: true,
            json: async () => ({
              id: opts.orderId || 'order_RzpLiveMock01',
              amount: opts.orderAmountPaise ?? 1000000,
              currency: opts.orderCurrency || 'INR',
              receipt: 'INV-SHARED-1001',
              status: 'created',
            }),
          } as any;
        }
        if (url.includes('/v1/payments/')) {
          return {
            ok: true,
            json: async () => ({
              id: opts.paymentId || 'pay_RzpLiveMock01',
              order_id: opts.paymentOrderId === undefined ? opts.orderId || 'order_RzpLiveMock01' : opts.paymentOrderId,
              amount: opts.paymentAmountPaise ?? 1000000,
              currency: opts.paymentCurrency || 'INR',
              status: opts.paymentStatus || 'captured',
              method: opts.paymentMethod || 'upi',
            }),
          } as any;
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });
    }

    it('P2-01. creates Razorpay order from server-side outstanding, hides secrets, and deduplicates open pending orders', async () => {
      configureTenant01Razorpay();
      const fetchSpy = mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Create01',
        orderAmountPaise: 1000000,
      });

      const created = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(created.orderId).toBe('order_Create01');
      expect(created.keyId).toBe(TENANT_KEY_ID);
      expect(created.amount).toBe(10000);
      expect(created.amountInPaise).toBe(1000000);
      expect(created.currency).toBe('INR');
      expect(created.reusedExistingOrder).toBe(false);
      expect(JSON.stringify(created)).not.toContain(TENANT_KEY_SECRET);
      expect(JSON.stringify(created)).not.toContain(TENANT_WEBHOOK_SECRET);
      expect(payments).toHaveLength(1);
      expect(payments[0].ref).toBe('RZP-ORD-order_Create01');
      expect(payments[0].providerRef).toBe('order_Create01');
      expect(payments[0].status).toBe(PaymentStatus.PENDING);

      // Duplicate order request for same invoice & same amount reuses existing PENDING order
      const reused = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(reused.reusedExistingOrder).toBe(true);
      expect(reused.orderId).toBe('order_Create01');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(payments).toHaveLength(1);
    });

    it('P2-02. rejects missing, PAID, or CANCELLED invoices when creating Razorpay order', async () => {
      configureTenant01Razorpay();

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_nonexistent' }),
      ).rejects.toThrow(NotFoundException);

      invoices[0].status = InvoiceStatus.PAID;
      invoices[0].outstanding = 0;
      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow('Invoice is already marked as PAID');

      invoices[0].status = InvoiceStatus.CANCELLED;
      invoices[0].outstanding = 10000;
      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow('Cannot create Razorpay order for CANCELLED invoice');
    });

    it('P2-03. enforces cross-tenant isolation and AGENT assignment rules on order creation and verify', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({ orderId: 'order_Auth01' });

      // Tenant 2 admin cannot access Tenant 1 invoice
      await expect(
        service.createRazorpayOrder(otherTenantUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow(NotFoundException);

      // Unassigned AGENT cannot create order on inv_01
      await expect(
        service.createRazorpayOrder(agentUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow(ForbiddenException);

      // Assign collection case to AGENT -> allowed
      collectionCases.push({
        id: 'cc_agent_1',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        assignedTo: 'usr_agent_01',
        status: 'OPEN',
      });
      const orderRes = await service.createRazorpayOrder(agentUser, { invoiceId: 'inv_01' });
      expect(orderRes.orderId).toBe('order_Auth01');

      // Other tenant cannot verify Tenant 1's order
      await expect(
        service.verifyRazorpayPayment(otherTenantUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Auth01',
          razorpay_payment_id: 'pay_RzpLiveMock01',
          razorpay_signature: signCheckout('order_Auth01', 'pay_RzpLiveMock01'),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('P2-04. validates amounts on order creation and rejects captured-amount tampering during verification', async () => {
      configureTenant01Razorpay();

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 0 }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 0.5 }),
      ).rejects.toThrow('Razorpay order amount must be at least 1.00 (100 paise)');

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 15000 }),
      ).rejects.toThrow('cannot exceed remaining invoice outstanding balance');

      // Create valid 10000 INR order, but Razorpay fetchPayment returns tampered 1000 paise (10 INR)
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_AmtCheck',
        orderAmountPaise: 1000000,
        paymentId: 'pay_AmtMismatch',
        paymentAmountPaise: 1000,
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_AmtCheck',
          razorpay_payment_id: 'pay_AmtMismatch',
          razorpay_signature: signCheckout('order_AmtCheck', 'pay_AmtMismatch'),
        }),
      ).rejects.toThrow('Payment amount mismatch');

      expect(invoices[0].outstanding).toBe(10000);
    });

    it('P2-05. validates currency on order creation and rejects gateway currency mismatch during verification', async () => {
      configureTenant01Razorpay();

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', currency: 'USD' }),
      ).rejects.toThrow('Currency mismatch');

      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_CurrCheck',
        orderAmountPaise: 1000000,
        paymentId: 'pay_CurrMismatch',
        paymentCurrency: 'USD',
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', currency: 'INR' });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_CurrCheck',
          razorpay_payment_id: 'pay_CurrMismatch',
          razorpay_signature: signCheckout('order_CurrCheck', 'pay_CurrMismatch'),
        }),
      ).rejects.toThrow('Payment currency mismatch');

      expect(invoices[0].outstanding).toBe(10000);
    });

    it('P2-06. rejects missing, placeholder, or non-prod rzp_live_ Razorpay credentials cleanly', async () => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow('Razorpay credentials (Key ID and Key Secret) are not configured');

      integrationConfigs['tenant_01:RAZORPAY'] = {
        keyId: 'your_razorpay_key_id',
        keySecret: 'your_razorpay_key_secret',
      };
      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow('Razorpay credentials (Key ID and Key Secret) are not configured');

      integrationConfigs['tenant_01:RAZORPAY'] = {
        keyId: 'rzp_live_forbidden_test_env',
        keySecret: 'real_live_secret_123',
      };
      await expect(
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ).rejects.toThrow('Live Razorpay credentials (rzp_live_*) cannot be used in non-production environments');
    });

    it('P2-07. rejects invalid or wrong-secret Checkout HMAC-SHA256 signature without fetching or settling', async () => {
      configureTenant01Razorpay();
      const fetchSpy = mockRazorpayFetchOrderAndPayment({ orderId: 'order_Sig01' });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Sig01',
          razorpay_payment_id: 'pay_Sig01',
          razorpay_signature: signCheckout('order_Sig01', 'pay_Sig01', 'wrong_secret'),
        }),
      ).rejects.toThrow('Invalid Razorpay payment signature');

      expect(fetchSpy).toHaveBeenCalledTimes(1); // Only createOrder; fetchPayment never called
      expect(invoices[0].outstanding).toBe(10000);
    });

    it('P2-08. rejects unknown or cross-invoice razorpay_order_id during Checkout verification', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({ orderId: 'order_Real01' });
      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Unknown999',
          razorpay_payment_id: 'pay_Any1',
          razorpay_signature: signCheckout('order_Unknown999', 'pay_Any1'),
        }),
      ).rejects.toThrow('Associated Razorpay order was not found for this invoice');
    });

    it('P2-09. rejects verify when gateway payment belongs to a different order_id or mismatches payment_id', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Mismatch01',
        paymentId: 'pay_BelongsElsewhere',
        paymentOrderId: 'order_CompletelyDifferent',
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Mismatch01',
          razorpay_payment_id: 'pay_BelongsElsewhere',
          razorpay_signature: signCheckout('order_Mismatch01', 'pay_BelongsElsewhere'),
        }),
      ).rejects.toThrow('Payment does not belong to the specified Razorpay order');

      // Also reject if gateway returns a different payment ID than requested
      vi.restoreAllMocks();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Mismatch01',
        paymentId: 'pay_GatewayOtherId',
        paymentOrderId: 'order_Mismatch01',
        paymentStatus: 'captured',
      });
      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Mismatch01',
          razorpay_payment_id: 'pay_SubmittedId',
          razorpay_signature: signCheckout('order_Mismatch01', 'pay_SubmittedId'),
        }),
      ).rejects.toThrow('Verified payment ID mismatch from Razorpay');

      expect(invoices[0].outstanding).toBe(10000);
    });

    it('P2-10. handles duplicate Checkout /verify submissions idempotently with zero double deduction', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Idemp01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_Idemp01',
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      const first = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Idemp01',
        razorpay_payment_id: 'pay_Idemp01',
        razorpay_signature: signCheckout('order_Idemp01', 'pay_Idemp01'),
      });
      expect(first.verified).toBe(true);
      expect(first.idempotent).toBe(false);
      expect(first.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(invoices[0].outstanding).toBe(0);

      const second = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Idemp01',
        razorpay_payment_id: 'pay_Idemp01',
        razorpay_signature: signCheckout('order_Idemp01', 'pay_Idemp01'),
      });
      expect(second.verified).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(invoices[0].outstanding).toBe(0);
      expect(customers[0].outstandingBalance).toBe(0);
      expect(payments.filter((p) => p.status === PaymentStatus.COMPLETED)).toHaveLength(1);
    });

    it('P2-11. handles Checkout-before-Webhook, Webhook-before-Checkout (order.paid), and concurrent verification safely', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Race01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_Race01',
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      const orderPaidBody = {
        event: 'order.paid',
        payload: {
          order: { entity: { id: 'order_Race01', amount: 1000000, currency: 'INR', receipt: 'INV-SHARED-1001' } },
          payment: { entity: { id: 'pay_Race01', order_id: 'order_Race01', amount: 1000000, currency: 'INR' } },
        },
      };
      const signedWh = signRazorpay(orderPaidBody, TENANT_WEBHOOK_SECRET);

      // Concurrent Checkout /verify + order.paid Webhook
      const [verifyRes, whRes] = await Promise.all([
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_Race01',
          razorpay_payment_id: 'pay_Race01',
          razorpay_signature: signCheckout('order_Race01', 'pay_Race01'),
        }),
        service.handleWebhook(
          'razorpay',
          orderPaidBody,
          { 'x-razorpay-signature': signedWh.signature, 'x-razorpay-event-id': 'evt_race_01' },
          signedWh.raw,
        ),
      ]);

      expect(verifyRes.verified).toBe(true);
      expect(whRes.processed).toBe(true);
      expect(invoices[0].outstanding).toBe(0);
      expect(invoices[0].status).toBe(InvoiceStatus.PAID);
      expect(customers[0].outstandingBalance).toBe(0);
      expect(payments.filter((p) => p.status === PaymentStatus.COMPLETED)).toHaveLength(1);

      // Now test reverse ordering: Webhook arrives BEFORE Checkout /verify on inv_b1 (tenant_02)
      integrationConfigs['tenant_02:RAZORPAY'] = {
        keyId: 'rzp_test_t02',
        keySecret: 'rzp_test_t02_secret_777',
        webhookSecret: 'rzp_whsec_t02_777',
      };
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_WhFirst02',
        orderAmountPaise: 1000000,
        paymentId: 'pay_WhFirst02',
        paymentStatus: 'captured',
      });
      await service.createRazorpayOrder(otherTenantUser, { invoiceId: 'inv_b1' });

      const whFirstBody = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_WhFirst02',
              order_id: 'order_WhFirst02',
              amount: 1000000,
              currency: 'INR',
            },
          },
        },
      };
      const signedWhFirst = signRazorpay(whFirstBody, 'rzp_whsec_t02_777');
      const whFirstRes = await service.handleWebhook(
        'razorpay',
        whFirstBody,
        { 'x-razorpay-signature': signedWhFirst.signature, 'x-razorpay-event-id': 'evt_wh_first_02' },
        signedWhFirst.raw,
      );
      expect(whFirstRes.invoiceStatus).toBe(InvoiceStatus.PAID);

      const lateCheckoutRes = await service.verifyRazorpayPayment(otherTenantUser, {
        invoiceId: 'inv_b1',
        razorpay_order_id: 'order_WhFirst02',
        razorpay_payment_id: 'pay_WhFirst02',
        razorpay_signature: signCheckout('order_WhFirst02', 'pay_WhFirst02', 'rzp_test_t02_secret_777'),
      });
      expect(lateCheckoutRes.verified).toBe(true);
      expect(lateCheckoutRes.idempotent).toBe(true);
      expect(invoices[1].outstanding).toBe(0);
      expect(customers[1].outstandingBalance).toBe(0);
    });

    it('P2-12. supports partial payments followed by remaining balance order via Checkout', async () => {
      configureTenant01Razorpay();

      // Partial payment #1: 4000 of 10000 INR
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Part1',
        orderAmountPaise: 400000,
        paymentId: 'pay_Part1',
        paymentAmountPaise: 400000,
        paymentStatus: 'captured',
      });
      const o1 = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 4000 });
      expect(o1.amountInPaise).toBe(400000);

      const v1 = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Part1',
        razorpay_payment_id: 'pay_Part1',
        razorpay_signature: signCheckout('order_Part1', 'pay_Part1'),
      });
      expect(v1.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(v1.remainingOutstanding).toBe(6000);
      expect(customers[0].outstandingBalance).toBe(6000);

      // Partial payment #2: remaining 6000 INR
      vi.restoreAllMocks();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Part2',
        orderAmountPaise: 600000,
        paymentId: 'pay_Part2',
        paymentAmountPaise: 600000,
        paymentStatus: 'captured',
      });
      const o2 = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(o2.amount).toBe(6000);
      expect(o2.reusedExistingOrder).toBe(false);

      const v2 = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Part2',
        razorpay_payment_id: 'pay_Part2',
        razorpay_signature: signCheckout('order_Part2', 'pay_Part2'),
      });
      expect(v2.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(v2.remainingOutstanding).toBe(0);
      expect(customers[0].outstandingBalance).toBe(0);
    });

    it('P2-13. resolves open CollectionCase and zeroes customer balance on full Checkout payment', async () => {
      configureTenant01Razorpay();
      collectionCases.push({
        id: 'cc_open_01',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        status: 'OPEN',
      });

      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Full01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_Full01',
        paymentAmountPaise: 1000000,
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      const res = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Full01',
        razorpay_payment_id: 'pay_Full01',
        razorpay_signature: signCheckout('order_Full01', 'pay_Full01'),
      });

      expect(res.verified).toBe(true);
      expect(res.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(res.remainingOutstanding).toBe(0);
      expect(collectionCases[0].status).toBe('RESOLVED');
      expect(customers[0].outstandingBalance).toBe(0);
    });

    it('P2-14. records FAILED or PENDING payments without reducing invoice or customer balance', async () => {
      configureTenant01Razorpay();

      // Pending (authorized / not yet captured)
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Pending01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_AuthPending01',
        paymentAmountPaise: 1000000,
        paymentStatus: 'authorized',
      });
      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      const authRes = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Pending01',
        razorpay_payment_id: 'pay_AuthPending01',
        razorpay_signature: signCheckout('order_Pending01', 'pay_AuthPending01'),
      });
      expect(authRes.verified).toBe(false);
      expect(authRes.status).toBe(PaymentStatus.PENDING);
      expect(invoices[0].outstanding).toBe(10000);

      // Failed payment
      vi.restoreAllMocks();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_Pending01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_Failed01',
        paymentAmountPaise: 1000000,
        paymentStatus: 'failed',
      });
      const failRes = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_Pending01',
        razorpay_payment_id: 'pay_Failed01',
        razorpay_signature: signCheckout('order_Pending01', 'pay_Failed01'),
      });
      expect(failRes.verified).toBe(false);
      expect(failRes.status).toBe(PaymentStatus.FAILED);
      expect(invoices[0].outstanding).toBe(10000);
      expect(customers[0].outstandingBalance).toBe(10000);
      expect(payments.some((p) => p.ref === 'PAY-FAIL-pay_Failed01' && p.status === PaymentStatus.FAILED)).toBe(true);
    });

    it('P2-15. allows creating a fresh order and succeeding when retrying after a failed payment', async () => {
      configureTenant01Razorpay();

      // Seed prior failed order/payment
      payments.push({
        id: 'pay_old_fail_row',
        ref: 'RZP-ORD-order_OldFailed',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        amount: 10000,
        currency: 'INR',
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.FAILED,
        providerRef: 'order_OldFailed',
        notes: 'Razorpay Checkout Order [order:order_OldFailed]',
        createdAt: new Date(Date.now() - 60000),
      });

      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_RetrySuccess01',
        orderAmountPaise: 1000000,
        paymentId: 'pay_RetrySuccess01',
        paymentAmountPaise: 1000000,
        paymentStatus: 'captured',
      });

      const retryOrder = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(retryOrder.orderId).toBe('order_RetrySuccess01');
      expect(retryOrder.reusedExistingOrder).toBe(false);

      const retryVerify = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_RetrySuccess01',
        razorpay_payment_id: 'pay_RetrySuccess01',
        razorpay_signature: signCheckout('order_RetrySuccess01', 'pay_RetrySuccess01'),
      });

      expect(retryVerify.verified).toBe(true);
      expect(retryVerify.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(invoices[0].outstanding).toBe(0);
      expect(customers[0].outstandingBalance).toBe(0);
    });

    it('P2-16 (C1). serializes two distinct concurrent partial payments on the same invoice under READ COMMITTED + FOR UPDATE', async () => {
      configureTenant01Razorpay();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          const body = JSON.parse(init.body);
          const id = body.amount === 400000 ? 'order_ConcA' : 'order_ConcB';
          return {
            ok: true,
            json: async () => ({
              id,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        if (url.endsWith('/v1/payments/pay_ConcA')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_ConcA',
              order_id: 'order_ConcA',
              amount: 400000,
              currency: 'INR',
              status: 'captured',
            }),
          } as any;
        }
        if (url.endsWith('/v1/payments/pay_ConcB')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_ConcB',
              order_id: 'order_ConcB',
              amount: 600000,
              currency: 'INR',
              status: 'captured',
            }),
          } as any;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 4000 });
      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 6000 });

      const [resA, resB] = await Promise.all([
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_ConcA',
          razorpay_payment_id: 'pay_ConcA',
          razorpay_signature: signCheckout('order_ConcA', 'pay_ConcA'),
        }),
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_ConcB',
          razorpay_payment_id: 'pay_ConcB',
          razorpay_signature: signCheckout('order_ConcB', 'pay_ConcB'),
        }),
      ]);

      expect(resA.verified).toBe(true);
      expect(resB.verified).toBe(true);
      expect(invoices[0].outstanding).toBe(0);
      expect(invoices[0].status).toBe(InvoiceStatus.PAID);
      expect(customers[0].outstandingBalance).toBe(0);
      expect(payments.filter((p) => p.status === PaymentStatus.COMPLETED)).toHaveLength(2);
    });

    it('P2-17 (C1). rethrows real PostgreSQL lock/deadlock errors and rolls back verify transaction', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_LockErr',
        orderAmountPaise: 1000000,
        paymentId: 'pay_LockErr',
        paymentAmountPaise: 1000000,
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });

      // Simulate PostgreSQL deadlock error (40P01) on FOR UPDATE lock
      const origTx = mockPrisma.$transaction;
      mockPrisma.$transaction = vi.fn().mockImplementation(async (cb: any) => {
        return origTx(async (tx: any) => {
          tx.$queryRaw = vi.fn().mockRejectedValueOnce(
            Object.assign(new Error('deadlock detected'), { code: '40P01' }),
          );
          return cb(tx);
        });
      });

      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_LockErr',
          razorpay_payment_id: 'pay_LockErr',
          razorpay_signature: signCheckout('order_LockErr', 'pay_LockErr'),
        }),
      ).rejects.toThrow('deadlock detected');
      expect(invoices[0].outstanding).toBe(10000);

      // Simulate transient DB failure mid-commit -> ACID rollback
      mockPrisma.$transaction = origTx;
      injectCommitFailure = true;
      await expect(
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_LockErr',
          razorpay_payment_id: 'pay_LockErr',
          razorpay_signature: signCheckout('order_LockErr', 'pay_LockErr'),
        }),
      ).rejects.toThrow('DB transient failure during commit');
      expect(invoices[0].outstanding).toBe(10000);
      expect(payments.filter((p) => p.status === PaymentStatus.COMPLETED)).toHaveLength(0);
    });

    it('P2-18 (C2). processes partial and full refunds via webhook, restores balances, reopens CollectionCase, and blocks over-refunds', async () => {
      configureTenant01Razorpay();
      collectionCases.push({
        id: 'cc_refund_01',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        status: 'OPEN',
      });
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_RfndSrc1',
        orderAmountPaise: 1000000,
        paymentId: 'pay_RfndSrc1',
        paymentAmountPaise: 1000000,
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_RfndSrc1',
        razorpay_payment_id: 'pay_RfndSrc1',
        razorpay_signature: signCheckout('order_RfndSrc1', 'pay_RfndSrc1'),
      });
      expect(invoices[0].status).toBe(InvoiceStatus.PAID);
      expect(invoices[0].outstanding).toBe(0);
      expect(collectionCases[0].status).toBe('RESOLVED');

      // 1. Partial refund of 4000 INR -> Payment remains COMPLETED, Invoice -> PARTIALLY_PAID (4000), CollectionCase -> OPEN
      const partRefund1Body = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_Part1',
              payment_id: 'pay_RfndSrc1',
              amount: 400000,
              currency: 'INR',
              status: 'processed',
            },
          },
          payment: { entity: { id: 'pay_RfndSrc1', order_id: 'order_RfndSrc1', amount: 1000000, currency: 'INR' } },
        },
      };
      const sRef1 = signRazorpay(partRefund1Body, TENANT_WEBHOOK_SECRET);
      const r1 = await service.handleWebhook(
        'razorpay',
        partRefund1Body,
        { 'x-razorpay-signature': sRef1.signature, 'x-razorpay-event-id': 'evt_rfnd_part1' },
        sRef1.raw,
      );
      expect(r1.status).toBe('REFUND_PROCESSED');
      expect(r1.paymentStatus).toBe(PaymentStatus.COMPLETED);
      expect(r1.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(r1.remainingInvoiceOutstanding).toBe(4000);
      expect(invoices[0].outstanding).toBe(4000);
      expect(customers[0].outstandingBalance).toBe(4000);
      expect(collectionCases[0].status).toBe('OPEN');

      // 2. Over-refund attempt (> remaining 6000) -> rejected, balance unchanged
      const overRefundBody = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_TooBig',
              payment_id: 'pay_RfndSrc1',
              amount: 700000,
              currency: 'INR',
              status: 'processed',
            },
          },
        },
      };
      const sOverRef = signRazorpay(overRefundBody, TENANT_WEBHOOK_SECRET);
      await expect(
        service.handleWebhook(
          'razorpay',
          overRefundBody,
          { 'x-razorpay-signature': sOverRef.signature, 'x-razorpay-event-id': 'evt_rfnd_over' },
          sOverRef.raw,
        ),
      ).rejects.toThrow('exceeds remaining refundable amount');
      expect(invoices[0].outstanding).toBe(4000);

      // 3. Second partial refund of remaining 6000 INR -> Payment transitions to REFUNDED, Invoice -> OPEN (10000)
      const partRefund2Body = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_Part2',
              payment_id: 'pay_RfndSrc1',
              amount: 600000,
              currency: 'INR',
              status: 'processed',
            },
          },
        },
      };
      const sRef2 = signRazorpay(partRefund2Body, TENANT_WEBHOOK_SECRET);
      const r2 = await service.handleWebhook(
        'razorpay',
        partRefund2Body,
        { 'x-razorpay-signature': sRef2.signature, 'x-razorpay-event-id': 'evt_rfnd_part2' },
        sRef2.raw,
      );
      expect(r2.status).toBe('REFUND_PROCESSED');
      expect(r2.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(r2.invoiceStatus).toBe(InvoiceStatus.OPEN);
      expect(invoices[0].outstanding).toBe(10000);
      expect(customers[0].outstandingBalance).toBe(10000);
      expect(paymentRefunds).toHaveLength(2);
    });

    it('P2-19 (C2). handles duplicate, failed, out-of-order, and concurrent refunds safely', async () => {
      configureTenant01Razorpay();

      // Seed pending order anchor BEFORE capture settles (test out-of-order refund.processed before capture!)
      payments.push({
        id: 'pay_ord_ooo',
        ref: 'RZP-ORD-order_Ooo1',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        amount: 10000,
        currency: 'INR',
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.PENDING,
        providerRef: 'order_Ooo1',
        notes: 'Razorpay Checkout Order [order:order_Ooo1]',
        createdAt: new Date(),
      });

      const earlyRefundBody = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: { id: 'rfnd_Early1', payment_id: 'pay_Ooo1', amount: 1000000, currency: 'INR', status: 'processed' },
          },
          payment: { entity: { id: 'pay_Ooo1', order_id: 'order_Ooo1', amount: 1000000, currency: 'INR' } },
        },
      };
      const sEarly = signRazorpay(earlyRefundBody, TENANT_WEBHOOK_SECRET);
      await expect(
        service.handleWebhook(
          'razorpay',
          earlyRefundBody,
          { 'x-razorpay-signature': sEarly.signature, 'x-razorpay-event-id': 'evt_early_rfnd' },
          sEarly.raw,
        ),
      ).rejects.toThrow('before payment pay_Ooo1 settlement is recorded');
      expect(webhookReplays).toHaveLength(0); // Rolled back cleanly!
      expect(invoices[0].outstanding).toBe(10000);

      // Now payment.captured settles pay_Ooo1
      const capBody = {
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_Ooo1', order_id: 'order_Ooo1', amount: 1000000, currency: 'INR' } },
        },
      };
      const sCap = signRazorpay(capBody, TENANT_WEBHOOK_SECRET);
      await service.handleWebhook(
        'razorpay',
        capBody,
        { 'x-razorpay-signature': sCap.signature, 'x-razorpay-event-id': 'evt_cap_ooo' },
        sCap.raw,
      );
      expect(invoices[0].outstanding).toBe(0);

      // Failed refund -> zero balance restoration, never marks payment REFUNDED
      const failRfndBody = {
        event: 'refund.failed',
        payload: {
          refund: { entity: { id: 'rfnd_Fail1', payment_id: 'pay_Ooo1', amount: 500000, currency: 'INR', status: 'failed' } },
        },
      };
      const sFailRf = signRazorpay(failRfndBody, TENANT_WEBHOOK_SECRET);
      const failRes = await service.handleWebhook(
        'razorpay',
        failRfndBody,
        { 'x-razorpay-signature': sFailRf.signature, 'x-razorpay-event-id': 'evt_rf_fail1' },
        sFailRf.raw,
      );
      expect(failRes.status).toBe('REFUND_FAILED');
      expect(invoices[0].outstanding).toBe(0);
      expect(customers[0].outstandingBalance).toBe(0);

      // Concurrent two partial refunds (rfnd_C1 = 3000, rfnd_C2 = 4000) -> cumulative 7000
      const conc1 = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_C1', payment_id: 'pay_Ooo1', amount: 300000, currency: 'INR' } } },
      };
      const conc2 = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_C2', payment_id: 'pay_Ooo1', amount: 400000, currency: 'INR' } } },
      };
      const sC1 = signRazorpay(conc1, TENANT_WEBHOOK_SECRET);
      const sC2 = signRazorpay(conc2, TENANT_WEBHOOK_SECRET);
      await Promise.all([
        service.handleWebhook(
          'razorpay',
          conc1,
          { 'x-razorpay-signature': sC1.signature, 'x-razorpay-event-id': 'evt_rf_c1' },
          sC1.raw,
        ),
        service.handleWebhook(
          'razorpay',
          conc2,
          { 'x-razorpay-signature': sC2.signature, 'x-razorpay-event-id': 'evt_rf_c2' },
          sC2.raw,
        ),
      ]);
      expect(invoices[0].outstanding).toBe(7000);
      expect(customers[0].outstandingBalance).toBe(7000);
      expect(payments[0].status).toBe(PaymentStatus.COMPLETED);

      // Duplicate refund.processed (distinct eventId, same rfnd_C1) AND late out-of-order refund.created for rfnd_C1 -> no double restore or downgrade
      const dupC1 = signRazorpay(conc1, TENANT_WEBHOOK_SECRET);
      const dupRes = await service.handleWebhook(
        'razorpay',
        conc1,
        { 'x-razorpay-signature': dupC1.signature, 'x-razorpay-event-id': 'evt_rf_c1_dup' },
        dupC1.raw,
      );
      expect(dupRes.idempotent).toBe(true);

      const staleCreated = {
        event: 'refund.created',
        payload: { refund: { entity: { id: 'rfnd_C1', payment_id: 'pay_Ooo1', amount: 300000, currency: 'INR', status: 'pending' } } },
      };
      const sStaleCr = signRazorpay(staleCreated, TENANT_WEBHOOK_SECRET);
      const staleRes = await service.handleWebhook(
        'razorpay',
        staleCreated,
        { 'x-razorpay-signature': sStaleCr.signature, 'x-razorpay-event-id': 'evt_rf_c1_created' },
        sStaleCr.raw,
      );
      expect(staleRes.idempotent).toBe(true);
      expect(staleRes.status).toBe('REFUND_PROCESSED');
      expect(invoices[0].outstanding).toBe(7000);
    });

    it('P2-20 (C2). verifyRazorpayPayment never classifies refunded gateway payments as FAILED and syncs confirmed refunds', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_VerRf1',
        orderAmountPaise: 1000000,
        paymentId: 'pay_VerRf1',
        paymentAmountPaise: 1000000,
        paymentStatus: 'captured',
      });
      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_VerRf1',
        razorpay_payment_id: 'pay_VerRf1',
        razorpay_signature: signCheckout('order_VerRf1', 'pay_VerRf1'),
      });
      expect(invoices[0].outstanding).toBe(0);

      // Now Razorpay reports status: 'refunded' + /payments/:id/refunds returns rfnd_GatewayFull1
      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.endsWith('/v1/payments/pay_VerRf1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_VerRf1',
              order_id: 'order_VerRf1',
              amount: 1000000,
              amount_refunded: 1000000,
              currency: 'INR',
              status: 'refunded',
            }),
          } as any;
        }
        if (url.endsWith('/v1/payments/pay_VerRf1/refunds')) {
          return {
            ok: true,
            json: async () => ({
              items: [
                {
                  id: 'rfnd_GatewayFull1',
                  payment_id: 'pay_VerRf1',
                  amount: 1000000,
                  currency: 'INR',
                  status: 'processed',
                },
              ],
            }),
          } as any;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      const verifyRefRes = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_VerRf1',
        razorpay_payment_id: 'pay_VerRf1',
        razorpay_signature: signCheckout('order_VerRf1', 'pay_VerRf1'),
      });
      expect(verifyRefRes.status).toBe('REFUNDED');
      expect(payments.some((p) => p.status === PaymentStatus.FAILED)).toBe(false);
      expect(payments.some((p) => p.status === PaymentStatus.REFUNDED)).toBe(true);
      expect(invoices[0].outstanding).toBe(10000);
      expect(customers[0].outstandingBalance).toBe(10000);
    });

    it('P2-21 (H1). handles concurrent createRazorpayOrder calls with only one provider order and refreshes expired intents', async () => {
      configureTenant01Razorpay();
      const fetchSpy = mockRazorpayFetchOrderAndPayment({
        orderId: 'order_SingleWinner1',
        orderAmountPaise: 1000000,
      });

      const results = await Promise.all([
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
        service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' }),
      ]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(new Set(results.map((r) => r.orderId))).toEqual(new Set(['order_SingleWinner1']));
      expect(results.filter((r) => !r.reusedExistingOrder)).toHaveLength(1);
      expect(results.filter((r) => r.reusedExistingOrder)).toHaveLength(3);

      // Force existing CREATED intent to expire -> next call creates a fresh order instead of reusing stale order
      paymentOrderIntents[0].expiresAt = new Date(Date.now() - 1000);
      vi.restoreAllMocks();
      const fetchSpy2 = mockRazorpayFetchOrderAndPayment({
        orderId: 'order_FreshAfterExpiry',
        orderAmountPaise: 1000000,
      });
      const fresh = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(fetchSpy2).toHaveBeenCalledTimes(1);
      expect(fresh.orderId).toBe('order_FreshAfterExpiry');
      expect(fresh.reusedExistingOrder).toBe(false);
      expect(paymentOrderIntents.some((i) => i.status === OrderIntentStatus.EXPIRED)).toBe(true);
    });

    it('P2-22 (H2). recovers cleanly from DB failures before/after Razorpay order creation and provider errors', async () => {
      configureTenant01Razorpay();

      // 1. Definitive HTTP 400 error -> marks intent FAILED & releases claim immediately so retry succeeds
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ error: { description: 'Validation error' } }),
          } as any;
        }
        return { ok: true, json: async () => ({ items: [] }) } as any;
      });

      await expect(service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' })).rejects.toThrow(
        'Razorpay Orders API error (400)',
      );
      expect(paymentOrderIntents[0].status).toBe(OrderIntentStatus.FAILED);
      expect(paymentOrderIntents[0].activeClaimKey).toBeNull();

      // 2. DB persistence fails AFTER Razorpay creates order -> intent preserved with providerOrderId -> retry recovers WITHOUT calling /v1/orders again
      vi.restoreAllMocks();
      const postSpy = mockRazorpayFetchOrderAndPayment({
        orderId: 'order_CreatedBeforeDbDrop',
        orderAmountPaise: 1000000,
      });
      const origTx = mockPrisma.$transaction;
      mockPrisma.$transaction = vi
        .fn()
        .mockRejectedValueOnce(new Error('DB write timeout'))
        .mockRejectedValueOnce(new Error('DB write timeout'))
        .mockRejectedValueOnce(new Error('DB write timeout'));

      await expect(service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' })).rejects.toThrow(
        'DB write timeout',
      );
      expect(postSpy).toHaveBeenCalledTimes(1);
      // Intent was preserved (not deleted!) with providerOrderId stored for recovery
      const preserved = paymentOrderIntents.find((i) => i.providerOrderId === 'order_CreatedBeforeDbDrop');
      expect(preserved).toBeDefined();
      expect(preserved.status).toBe(OrderIntentStatus.CREATING);

      // Restore DB & retry -> recovers existing order without hitting POST /v1/orders again!
      mockPrisma.$transaction = origTx;
      const recovered = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(recovered.orderId).toBe('order_CreatedBeforeDbDrop');
      expect(recovered.reusedExistingOrder).toBe(true);
      expect(recovered.recovered).toBe(true);
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('P2-23 (E/M1/M2). picks canonical RZP-ORD anchor over PAY-FAIL on partial order retry and handles providerOrderId-only webhooks', async () => {
      configureTenant01Razorpay();
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_PartialCanonical',
        orderAmountPaise: 400000,
        paymentId: 'pay_PartialRetryOk',
        paymentAmountPaise: 400000,
        paymentStatus: 'captured',
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01', amount: 4000 });

      // Simulate earlier payment.failed webhook WITHOUT amount field -> stored PAY-FAIL row with full 10000 invoice outstanding!
      // Insert it BEFORE/alongside payments to prove canonical RZP-ORD selection regardless of array order
      payments.unshift({
        id: 'pay_fail_earlier_partial',
        ref: 'PAY-FAIL-pay_PriorFailNoAmt',
        tenantId: 'tenant_01',
        customerId: 'cust_01',
        invoiceId: 'inv_01',
        amount: 10000,
        currency: 'INR',
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.FAILED,
        providerRef: 'pay_PriorFailNoAmt',
        notes: 'Payment failed via RAZORPAY webhook [order:order_PartialCanonical]',
        createdAt: new Date(Date.now() - 1000),
      });

      const verifyOk = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: 'order_PartialCanonical',
        razorpay_payment_id: 'pay_PartialRetryOk',
        razorpay_signature: signCheckout('order_PartialCanonical', 'pay_PartialRetryOk'),
      });
      expect(verifyOk.verified).toBe(true);
      expect(verifyOk.paidAmount).toBe(4000);
      expect(invoices[0].outstanding).toBe(6000);

      // M2: providerOrderId-only order.paid webhook deduplicated even without payment.entity.id
      const orderOnlyBody = {
        event: 'order.paid',
        payload: {
          order: { entity: { id: 'order_PartialCanonical', amount_paid: 400000, currency: 'INR' } },
        },
      };
      const sOrderOnly = signRazorpay(orderOnlyBody, TENANT_WEBHOOK_SECRET);
      const dupOrderOnly = await service.handleWebhook(
        'razorpay',
        orderOnlyBody,
        { 'x-razorpay-signature': sOrderOnly.signature, 'x-razorpay-event-id': 'evt_m2_order_only' },
        sOrderOnly.raw,
      );
      expect(dupOrderOnly.idempotent).toBe(true);
      expect(invoices[0].outstanding).toBe(6000);
    });

    it('P2-24 (F). rejects DRAFT invoices, blocks partial tenant creds, enforces consistent simulation policy, and audits authorized state', async () => {
      configureTenant01Razorpay();

      // Reject DRAFT invoice
      invoices[0].status = InvoiceStatus.DRAFT;
      await expect(service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' })).rejects.toThrow(
        'Cannot create Razorpay order for DRAFT invoice',
      );
      invoices[0].status = InvoiceStatus.OPEN;

      // Reject partial tenant config (keyId without keySecret) even when global env vars are present
      process.env.RAZORPAY_KEY_ID = 'rzp_test_global_ok';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_test_global_secret_ok';
      integrationConfigs['tenant_01:RAZORPAY'] = { keyId: 'rzp_test_only_keyid' };
      await expect(service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' })).rejects.toThrow(
        'Incomplete tenant Razorpay configuration',
      );

      // Unified non-prod simulation policy: createOrder({ simulate: true }) -> verifyRazorpayPayment works consistently
      integrationConfigs['tenant_01:RAZORPAY'] = {};
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      const simOrd = await service.createRazorpayOrder(adminUser, {
        invoiceId: 'inv_01',
        simulate: true,
      });
      expect(simOrd.isSimulated).toBe(true);
      expect(simOrd.orderId).toMatch(/^order_sim_/);
      const simVerify = await service.verifyRazorpayPayment(adminUser, {
        invoiceId: 'inv_01',
        razorpay_order_id: simOrd.orderId,
        razorpay_payment_id: 'pay_sim_ok_01',
        razorpay_signature: 'sim_checkout_ok',
      });
      expect(simVerify.verified).toBe(true);
      expect(invoices[0].outstanding).toBe(0);

      // Audit logging for authorized/PENDING state
      invoices[1].status = InvoiceStatus.OPEN;
      integrationConfigs['tenant_02:RAZORPAY'] = {
        keyId: TENANT_KEY_ID,
        keySecret: TENANT_KEY_SECRET,
        webhookSecret: TENANT_WEBHOOK_SECRET,
      };
      mockRazorpayFetchOrderAndPayment({
        orderId: 'order_AuthAudit',
        orderAmountPaise: 1000000,
        paymentId: 'pay_AuthAudit',
        paymentAmountPaise: 1000000,
        paymentStatus: 'authorized',
      });
      await service.createRazorpayOrder(otherTenantUser, { invoiceId: 'inv_b1' });
      const pendingRes = await service.verifyRazorpayPayment(otherTenantUser, {
        invoiceId: 'inv_b1',
        razorpay_order_id: 'order_AuthAudit',
        razorpay_payment_id: 'pay_AuthAudit',
        razorpay_signature: signCheckout('order_AuthAudit', 'pay_AuthAudit'),
      });
      expect(pendingRes.status).toBe('PENDING');
      expect(auditLogs.some((a) => a.action === 'payment.authorized_pending_capture')).toBe(true);
    });

    it('P2-25. serializes concurrent settlements and refunds across two different invoices of the same customer', async () => {
      configureTenant01Razorpay();

      // Customer cust_01 now has TWO invoices: inv_01 (4000) + inv_02 (6000) => 10000 total
      invoices[0].amount = 4000;
      invoices[0].outstanding = 4000;
      invoices.push({
        id: 'inv_02',
        number: 'INV-SHARED-1002',
        amount: 6000,
        outstanding: 6000,
        currency: 'INR',
        status: InvoiceStatus.OPEN,
        customerId: 'cust_01',
        tenantId: 'tenant_01',
      });
      customers[0].outstandingBalance = 10000;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          const body = JSON.parse(init.body);
          const id = body.amount === 400000 ? 'order_CustInv1' : 'order_CustInv2';
          return {
            ok: true,
            json: async () => ({
              id,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        if (url.endsWith('/v1/payments/pay_CustInv1')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_CustInv1',
              order_id: 'order_CustInv1',
              amount: 400000,
              currency: 'INR',
              status: 'captured',
            }),
          } as any;
        }
        if (url.endsWith('/v1/payments/pay_CustInv2')) {
          return {
            ok: true,
            json: async () => ({
              id: 'pay_CustInv2',
              order_id: 'order_CustInv2',
              amount: 600000,
              currency: 'INR',
              status: 'captured',
            }),
          } as any;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_02' });

      // Settle both invoices of cust_01 concurrently
      await Promise.all([
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_01',
          razorpay_order_id: 'order_CustInv1',
          razorpay_payment_id: 'pay_CustInv1',
          razorpay_signature: signCheckout('order_CustInv1', 'pay_CustInv1'),
        }),
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: 'inv_02',
          razorpay_order_id: 'order_CustInv2',
          razorpay_payment_id: 'pay_CustInv2',
          razorpay_signature: signCheckout('order_CustInv2', 'pay_CustInv2'),
        }),
      ]);

      expect(invoices[0].outstanding).toBe(0);
      expect(invoices[2].outstanding).toBe(0);
      expect(customers[0].outstandingBalance).toBe(0);

      // Now refund 1500 on inv_01 and 2500 on inv_02 concurrently -> cust_01 balance must be exact 4000
      const rf1 = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_CustInv1', payment_id: 'pay_CustInv1', amount: 150000, currency: 'INR' } } },
      };
      const rf2 = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_CustInv2', payment_id: 'pay_CustInv2', amount: 250000, currency: 'INR' } } },
      };
      const sRf1 = signRazorpay(rf1, TENANT_WEBHOOK_SECRET);
      const sRf2 = signRazorpay(rf2, TENANT_WEBHOOK_SECRET);

      await Promise.all([
        service.handleWebhook(
          'razorpay',
          rf1,
          { 'x-razorpay-signature': sRf1.signature, 'x-razorpay-event-id': 'evt_cust_rf1' },
          sRf1.raw,
        ),
        service.handleWebhook(
          'razorpay',
          rf2,
          { 'x-razorpay-signature': sRf2.signature, 'x-razorpay-event-id': 'evt_cust_rf2' },
          sRf2.raw,
        ),
      ]);

      expect(invoices[0].outstanding).toBe(1500);
      expect(invoices[2].outstanding).toBe(2500);
      expect(customers[0].outstandingBalance).toBe(4000);
    });

    it('P2-26. recovers delayed order after initial timeout + empty receipt lookup without creating duplicate order', async () => {
      configureTenant01Razorpay();
      let postCalls = 0;
      let receiptCalls = 0;
      let capturedReceipt = '';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders') && init?.method === 'POST') {
          postCalls++;
          capturedReceipt = JSON.parse(init.body).receipt;
          throw new Error('Socket timeout after request sent');
        }
        if (url.includes('/v1/orders?receipt=')) {
          receiptCalls++;
          if (receiptCalls === 1) {
            // Delayed visibility on immediate check -> empty items
            return { ok: true, json: async () => ({ items: [] }) } as any;
          }
          // Retry check finds the order created during the timed-out request!
          return {
            ok: true,
            json: async () => ({
              items: [
                {
                  id: 'order_DelayedVisible1',
                  amount: 1000000,
                  currency: 'INR',
                  receipt: capturedReceipt,
                  status: 'created',
                },
              ],
            }),
          } as any;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      await expect(service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' })).rejects.toThrow(
        'Socket timeout',
      );
      expect(postCalls).toBe(1);
      expect(receiptCalls).toBe(1);
      expect(paymentOrderIntents[0].status).toBe(OrderIntentStatus.CREATING);
      expect(paymentOrderIntents[0].errorMessage).toBe('UNCERTAIN_PROVIDER_TIMEOUT');

      // Retry recovers order_DelayedVisible1 via receipt lookup WITHOUT making a second POST /v1/orders call!
      const recovered = await service.createRazorpayOrder(adminUser, { invoiceId: 'inv_01' });
      expect(postCalls).toBe(1);
      expect(receiptCalls).toBe(2);
      expect(recovered.orderId).toBe('order_DelayedVisible1');
      expect(recovered.reusedExistingOrder).toBe(true);
      expect(recovered.recovered).toBe(true);
    });
  });
});
