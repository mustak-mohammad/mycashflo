-- CreateEnum
CREATE TYPE "ActionRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "riskLevel" "ActionRisk" NOT NULL DEFAULT 'MEDIUM',
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "result" JSONB,
    "expiresAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "proposedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionProposal_tenantId_idx" ON "ActionProposal"("tenantId");

-- CreateIndex
CREATE INDEX "ActionProposal_tenantId_status_idx" ON "ActionProposal"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
