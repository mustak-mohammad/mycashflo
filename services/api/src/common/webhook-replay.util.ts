export const DEFAULT_WEBHOOK_REPLAY_TTL_MS = 15 * 60 * 1000;

export interface WebhookReplayRepository {
  create: (args: {
    data: { provider: string; replayKey: string; expiresAt: Date };
  }) => Promise<any>;
  updateMany?: (args: {
    where: { replayKey: string; expiresAt: { lte: Date } };
    data: { provider: string; expiresAt: Date };
  }) => Promise<{ count: number }>;
  deleteMany?: (args: {
    where: { replayKey?: string; expiresAt: { lte: Date } };
  }) => Promise<{ count: number }>;
}

/**
 * Safely deletes strictly expired WebhookReplay rows (expiresAt <= now),
 * leaving all active unexpired records intact.
 * Must be called on the top-level Prisma client (outside interactive transactions).
 */
export async function pruneExpiredWebhookReplays(
  prisma: { webhookReplay?: WebhookReplayRepository },
  now = new Date(),
): Promise<number> {
  if (!prisma?.webhookReplay?.deleteMany) {
    return 0;
  }
  const res = await prisma.webhookReplay.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return res?.count ?? 0;
}

/**
 * Atomically claims a webhook replay key in PostgreSQL (safe inside `$transaction`).
 *
 * Strategy (PostgreSQL 25P02-safe):
 * 1. Delete strictly if `replayKey` exists AND is already expired (`expiresAt <= now`).
 *    Active rows (`expiresAt > now`) are untouched, so this never errors or aborts tx.
 * 2. Attempt `create` on the unique `replayKey`.
 *    - Concurrent callers race on the PostgreSQL unique index: at most one inserts.
 *    - If an active row exists (or a concurrent tx committed first), `P2002` is caught
 *      and `false` is returned immediately (with no subsequent queries on `tx`).
 *    - If the enclosing `$transaction` rolls back later, PostgreSQL automatically rolls
 *      back the claimed row so a legitimate retry can succeed cleanly.
 */
export async function claimWebhookReplayKey(
  prismaOrTx: { webhookReplay?: WebhookReplayRepository },
  provider: string,
  replayKey: string,
  ttlMs = DEFAULT_WEBHOOK_REPLAY_TTL_MS,
  now = new Date(),
): Promise<boolean> {
  if (!prismaOrTx?.webhookReplay || typeof prismaOrTx.webhookReplay.create !== 'function') {
    throw new Error('WebhookReplay database repository is unavailable');
  }

  const expiresAt = new Date(now.getTime() + ttlMs);

  // Recycle only an already-expired entry for this specific replayKey before inserting,
  // avoiding post-error queries inside a PostgreSQL transaction block (SQLSTATE 25P02).
  if (typeof prismaOrTx.webhookReplay.deleteMany === 'function') {
    await prismaOrTx.webhookReplay.deleteMany({
      where: {
        replayKey,
        expiresAt: { lte: now },
      },
    });
  }

  try {
    await prismaOrTx.webhookReplay.create({
      data: {
        provider,
        replayKey,
        expiresAt,
      },
    });
    return true;
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return false;
    }
    throw err;
  }
}
