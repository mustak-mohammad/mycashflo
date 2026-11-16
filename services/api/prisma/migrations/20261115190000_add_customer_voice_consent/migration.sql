-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "voiceConsent" "ConsentState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "voiceConsentAt" TIMESTAMP(3),
ADD COLUMN "voiceConsentSource" TEXT;
