-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderIntentStatus" AS ENUM ('CREATING', 'CREATED', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerRefundId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rawEvent" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrderIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "activeClaimKey" TEXT,
    "receipt" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "amountInPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "OrderIntentStatus" NOT NULL DEFAULT 'CREATING',
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerOrderId" TEXT,
    "paymentId" TEXT,
    "keyId" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrderIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");

-- CreateIndex
CREATE INDEX "PaymentRefund_tenantId_idx" ON "PaymentRefund"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRefund_invoiceId_idx" ON "PaymentRefund"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentRefund_providerPaymentId_idx" ON "PaymentRefund"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderIntent_idempotencyKey_key" ON "PaymentOrderIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderIntent_activeClaimKey_key" ON "PaymentOrderIntent"("activeClaimKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderIntent_receipt_key" ON "PaymentOrderIntent"("receipt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderIntent_providerOrderId_key" ON "PaymentOrderIntent"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrderIntent_paymentId_key" ON "PaymentOrderIntent"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentOrderIntent_tenantId_invoiceId_status_idx" ON "PaymentOrderIntent"("tenantId", "invoiceId", "status");

-- CreateIndex
CREATE INDEX "PaymentOrderIntent_expiresAt_idx" ON "PaymentOrderIntent"("expiresAt");

-- CreateIndex
CREATE INDEX "Payment_providerRef_idx" ON "Payment"("providerRef");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrderIntent" ADD CONSTRAINT "PaymentOrderIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrderIntent" ADD CONSTRAINT "PaymentOrderIntent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrderIntent" ADD CONSTRAINT "PaymentOrderIntent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

