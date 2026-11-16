-- CreateEnum
CREATE TYPE "OutboxJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'DISPATCHING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'SUPPRESSED', 'UNCERTAIN', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "OutboxJobType" AS ENUM ('REMINDER', 'PAYMENT_RECEIPT', 'CUSTOM_NOTIFICATION');

-- CreateEnum
CREATE TYPE "ReminderStage" AS ENUM ('DUE_SOON', 'DUE_TODAY', 'OVERDUE_STAGE_1', 'OVERDUE_STAGE_2', 'OVERDUE_STAGE_3');

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "notificationId" TEXT,
    "jobType" "OutboxJobType" NOT NULL DEFAULT 'REMINDER',
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "stage" "ReminderStage",
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxJobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "dispatchStartedAt" TIMESTAMP(3),
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "payload" JSONB,
    "lastError" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciliationSource" TEXT,
    "requeuedAt" TIMESTAMP(3),
    "requeuedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- Business-Reference Invariants CHECK Constraint
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "chk_outbox_job_type_refs" CHECK (
    (
        "jobType" = 'REMINDER' AND
        "invoiceId" IS NOT NULL AND
        "paymentId" IS NULL AND
        "stage" IS NOT NULL
    ) OR (
        "jobType" = 'PAYMENT_RECEIPT' AND
        "paymentId" IS NOT NULL AND
        "stage" IS NULL
    ) OR (
        "jobType" = 'CUSTOM_NOTIFICATION'
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_notificationId_key" ON "NotificationOutbox"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_tenantId_idempotencyKey_key" ON "NotificationOutbox"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_idx" ON "NotificationOutbox"("tenantId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_customerId_idx" ON "NotificationOutbox"("customerId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_invoiceId_idx" ON "NotificationOutbox"("invoiceId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_paymentId_idx" ON "NotificationOutbox"("paymentId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_scheduledFor_idx" ON "NotificationOutbox"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationOutbox_leaseExpiresAt_idx" ON "NotificationOutbox"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_nextRetryAt_idx" ON "NotificationOutbox"("nextRetryAt");

-- CreatePartialIndexes (PostgreSQL High-Performance Operational Indexes)
CREATE INDEX "idx_outbox_pending_scheduled" ON "NotificationOutbox" ("scheduledFor" ASC) WHERE status = 'PENDING';

CREATE INDEX "idx_outbox_lease_expiry" ON "NotificationOutbox" ("leaseExpiresAt" ASC) WHERE status IN ('CLAIMED', 'DISPATCHING');

CREATE INDEX "idx_outbox_retry_wait" ON "NotificationOutbox" ("nextRetryAt" ASC) WHERE status = 'RETRY_WAIT';

CREATE INDEX "idx_outbox_invoice_cancellation" ON "NotificationOutbox" ("tenantId", "invoiceId") WHERE status IN ('PENDING', 'RETRY_WAIT', 'CLAIMED');

-- CreatePartialUniqueIndex (Provider Correlation Uniqueness)
CREATE UNIQUE INDEX "idx_outbox_provider_message_id_unique" ON "NotificationOutbox" ("provider", "providerMessageId") WHERE "providerMessageId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (Consistent with Invoice/Payment/Notification: RESTRICT customer deletion)
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. Child-Side Integrity Trigger
-- Concurrency-safe: uses explicit lock ordering (Customer -> Invoice -> Payment) with FOR SHARE row locking
-- to eliminate race conditions with concurrent parent updates or deletions without deadlock risk.
CREATE OR REPLACE FUNCTION check_outbox_tenant_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_cust_tenant TEXT;
    v_inv_tenant TEXT;
    v_inv_customer TEXT;
    v_pay_tenant TEXT;
    v_pay_customer TEXT;
    v_pay_invoice TEXT;
BEGIN
    -- 1. Lock and verify Customer row in SHARE mode.
    SELECT "tenantId" INTO v_cust_tenant
    FROM "Customer"
    WHERE id = NEW."customerId"
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multi-tenant integrity violation: Customer % does not exist', NEW."customerId";
    END IF;

    IF v_cust_tenant <> NEW."tenantId" THEN
        RAISE EXCEPTION 'Multi-tenant integrity violation: Customer % belongs to Tenant %, not Outbox Tenant %',
            NEW."customerId", v_cust_tenant, NEW."tenantId";
    END IF;

    -- 2. Lock and verify Invoice row in SHARE mode (if present).
    IF NEW."invoiceId" IS NOT NULL THEN
        SELECT "tenantId", "customerId" INTO v_inv_tenant, v_inv_customer
        FROM "Invoice"
        WHERE id = NEW."invoiceId"
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Multi-tenant integrity violation: Invoice % does not exist', NEW."invoiceId";
        END IF;

        IF v_inv_tenant <> NEW."tenantId" OR v_inv_customer <> NEW."customerId" THEN
            RAISE EXCEPTION 'Multi-tenant integrity violation: Invoice % (Tenant %, Customer %) does not match Outbox (Tenant %, Customer %)',
                NEW."invoiceId", v_inv_tenant, v_inv_customer, NEW."tenantId", NEW."customerId";
        END IF;
    END IF;

    -- 3. Lock and verify Payment row in SHARE mode (if present).
    IF NEW."paymentId" IS NOT NULL THEN
        SELECT "tenantId", "customerId", "invoiceId" INTO v_pay_tenant, v_pay_customer, v_pay_invoice
        FROM "Payment"
        WHERE id = NEW."paymentId"
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Multi-tenant integrity violation: Payment % does not exist', NEW."paymentId";
        END IF;

        IF v_pay_tenant <> NEW."tenantId" OR v_pay_customer <> NEW."customerId" THEN
            RAISE EXCEPTION 'Multi-tenant integrity violation: Payment % (Tenant %, Customer %) does not match Outbox (Tenant %, Customer %)',
                NEW."paymentId", v_pay_tenant, v_pay_customer, NEW."tenantId", NEW."customerId";
        END IF;

        -- 4. Cross-Entity Invariant: If invoiceId is also specified on Outbox, verify it matches Payment.invoiceId
        IF NEW."invoiceId" IS NOT NULL AND v_pay_invoice IS NOT NULL AND v_pay_invoice <> NEW."invoiceId" THEN
            RAISE EXCEPTION 'Cross-entity integrity violation: Outbox invoiceId % does not match Payment invoiceId %',
                NEW."invoiceId", v_pay_invoice;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbox_tenant_integrity
BEFORE INSERT OR UPDATE ON "NotificationOutbox"
FOR EACH ROW
EXECUTE FUNCTION check_outbox_tenant_integrity();

-- 2. Parent-Side Integrity Triggers
-- Prevents subsequent parent updates on Customer, Invoice, or Payment that would invalidate existing outbox rows.

-- Customer Parent Trigger
CREATE OR REPLACE FUNCTION check_customer_outbox_parent_integrity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tenantId" <> OLD."tenantId" THEN
        IF EXISTS (
            SELECT 1 FROM "NotificationOutbox"
            WHERE "customerId" = OLD.id AND "tenantId" = OLD."tenantId"
        ) THEN
            RAISE EXCEPTION 'Parent-side integrity violation: Cannot change Customer % tenant from % to % because existing outbox records reference this customer',
                OLD.id, OLD."tenantId", NEW."tenantId";
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_outbox_parent_integrity
BEFORE UPDATE OF "tenantId" ON "Customer"
FOR EACH ROW
EXECUTE FUNCTION check_customer_outbox_parent_integrity();

-- Invoice Parent Trigger
CREATE OR REPLACE FUNCTION check_invoice_outbox_parent_integrity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tenantId" <> OLD."tenantId" OR NEW."customerId" <> OLD."customerId" THEN
        IF EXISTS (
            SELECT 1 FROM "NotificationOutbox"
            WHERE "invoiceId" = OLD.id
        ) THEN
            RAISE EXCEPTION 'Parent-side integrity violation: Cannot change Invoice % tenant or customer because existing outbox records reference this invoice',
                OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_outbox_parent_integrity
BEFORE UPDATE OF "tenantId", "customerId" ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION check_invoice_outbox_parent_integrity();

-- Payment Parent Trigger
CREATE OR REPLACE FUNCTION check_payment_outbox_parent_integrity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tenantId" <> OLD."tenantId" OR NEW."customerId" <> OLD."customerId" OR (OLD."invoiceId" IS NOT NULL AND NEW."invoiceId" <> OLD."invoiceId") THEN
        IF EXISTS (
            SELECT 1 FROM "NotificationOutbox"
            WHERE "paymentId" = OLD.id
        ) THEN
            RAISE EXCEPTION 'Parent-side integrity violation: Cannot change Payment % tenant, customer, or invoice because existing outbox records reference this payment',
                OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_outbox_parent_integrity
BEFORE UPDATE OF "tenantId", "customerId", "invoiceId" ON "Payment"
FOR EACH ROW
EXECUTE FUNCTION check_payment_outbox_parent_integrity();
