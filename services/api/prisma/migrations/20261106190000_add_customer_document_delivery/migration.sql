-- CreateEnum
CREATE TYPE "DocumentRequestType" AS ENUM ('INVOICE', 'PAYMENT_LINK', 'BOTH');

-- CreateEnum
CREATE TYPE "DeliveryChannelPreference" AS ENUM ('WHATSAPP', 'EMAIL', 'WHATSAPP_AND_EMAIL');

-- CreateEnum
CREATE TYPE "DocumentDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryAttemptChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('PENDING', 'SIMULATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "DocumentDeliveryRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "callSessionId" TEXT,
    "requestType" "DocumentRequestType" NOT NULL DEFAULT 'BOTH',
    "deliveryChannel" "DeliveryChannelPreference" NOT NULL DEFAULT 'WHATSAPP_AND_EMAIL',
    "status" "DocumentDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDeliveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "channel" "DeliveryAttemptChannel" NOT NULL,
    "destinationMasked" TEXT NOT NULL,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDeliveryRequest_idempotencyKey_key" ON "DocumentDeliveryRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_tenantId_idx" ON "DocumentDeliveryRequest"("tenantId");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_customerId_idx" ON "DocumentDeliveryRequest"("customerId");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_invoiceId_idx" ON "DocumentDeliveryRequest"("invoiceId");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_callSessionId_idx" ON "DocumentDeliveryRequest"("callSessionId");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_status_idx" ON "DocumentDeliveryRequest"("status");

-- CreateIndex
CREATE INDEX "DocumentDeliveryRequest_createdAt_idx" ON "DocumentDeliveryRequest"("createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_tenantId_idx" ON "DeliveryAttempt"("tenantId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_requestId_idx" ON "DeliveryAttempt"("requestId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_idx" ON "DeliveryAttempt"("status");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_channel_idx" ON "DeliveryAttempt"("channel");

-- AddForeignKey
ALTER TABLE "DocumentDeliveryRequest" ADD CONSTRAINT "DocumentDeliveryRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeliveryRequest" ADD CONSTRAINT "DocumentDeliveryRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeliveryRequest" ADD CONSTRAINT "DocumentDeliveryRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDeliveryRequest" ADD CONSTRAINT "DocumentDeliveryRequest_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocumentDeliveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

