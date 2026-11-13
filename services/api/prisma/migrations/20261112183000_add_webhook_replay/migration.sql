-- CreateTable
CREATE TABLE "WebhookReplay" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "replayKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReplay_replayKey_key" ON "WebhookReplay"("replayKey");

-- CreateIndex
CREATE INDEX "WebhookReplay_expiresAt_idx" ON "WebhookReplay"("expiresAt");

