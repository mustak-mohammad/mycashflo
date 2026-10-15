-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "stage" TEXT;

-- CreateTable
CREATE TABLE "VoicePrompt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "promptText" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'COLLECTIONS',
    "language" TEXT NOT NULL DEFAULT 'en-IN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoicePrompt_tenantId_idx" ON "VoicePrompt"("tenantId");

-- CreateIndex
CREATE INDEX "VoicePrompt_tenantId_category_idx" ON "VoicePrompt"("tenantId", "category");

-- CreateIndex
CREATE INDEX "VoicePrompt_tenantId_isActive_idx" ON "VoicePrompt"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "VoicePrompt" ADD CONSTRAINT "VoicePrompt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoicePrompt" ADD CONSTRAINT "VoicePrompt_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
