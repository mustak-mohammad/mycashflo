-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- AlterEnum
ALTER TYPE "NotifStatus" ADD VALUE 'SUPPRESSED';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "emailConsent" "ConsentState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "emailConsentAt" TIMESTAMP(3),
ADD COLUMN "emailConsentSource" TEXT,
ADD COLUMN "whatsappConsent" "ConsentState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "whatsappConsentAt" TIMESTAMP(3),
ADD COLUMN "whatsappConsentSource" TEXT,
ADD COLUMN "smsConsent" "ConsentState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "smsConsentAt" TIMESTAMP(3),
ADD COLUMN "smsConsentSource" TEXT;
