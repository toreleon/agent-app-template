/**
 * Access layer for the ISOLATED Sites mini-app datastore (prisma/sites-data.prisma
 * → sites-data.db). See that schema for WHY this is a separate DB/client.
 *
 * Two things live here:
 *  1. `sitesDataDb` — a singleton client for the second SQLite file, opened WAL +
 *     busy_timeout so concurrent public writers wait briefly instead of erroring
 *     and reads don't block on writes.
 *  2. `siteStore` — a TENANT-SCOPED repository. Every method takes `siteId` as a
 *     required first argument and every query filters on it, so a forgotten
 *     tenant filter is a *type error*, never a cross-site data leak. Nothing
 *     outside this module should touch `sitesDataDb` directly.
 *
 * Quota is enforced ATOMICALLY: each write runs in an interactive transaction
 * that adjusts the denormalized `SiteUsage` counters and throws
 * `SiteQuotaExceededError` (rolling back) when a Site would exceed its byte
 * budget — no check-then-write race, no `SUM()` per write.
 */
import { PrismaClient } from "@/generated/sites-data-client";

// ---------------------------------------------------------------------------
// Client singleton (global-cached to survive Next.js dev hot-reload)
// ---------------------------------------------------------------------------

const globalForSitesData = globalThis as unknown as {
  sitesDataDb: PrismaClient | undefined;
  sitesDataInit: Promise<void> | undefined;
};

export const sitesDataDb: PrismaClient =
  globalForSitesData.sitesDataDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForSitesData.sitesDataDb = sitesDataDb;
}

/**
 * Apply per-connection pragmas once per process. WAL is persistent (stored in the
 * DB file) but harmless to re-assert; busy_timeout is per-connection. Callers
 * that do a write should `await ensureSitesData()` first. Cached on globalThis so
 * it runs once across hot-reloads.
 */
export function ensureSitesData(): Promise<void> {
  if (!globalForSitesData.sitesDataInit) {
    globalForSitesData.sitesDataInit = (async () => {
      // $queryRawUnsafe (not $executeRawUnsafe): these PRAGMAs return a row, and
      // SQLite's execute path rejects result-returning statements.
      await sitesDataDb.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await sitesDataDb.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    })().catch((err) => {
      globalForSitesData.sitesDataInit = undefined; // allow a later retry
      throw err;
    });
  }
  return globalForSitesData.sitesDataInit;
}

// ---------------------------------------------------------------------------
// Errors + types
// ---------------------------------------------------------------------------

/** Thrown (rolling back the write) when a Site would exceed its byte quota. */
export class SiteQuotaExceededError extends Error {
  constructor(
    readonly siteId: string,
    readonly needed: number,
    readonly quota: number,
  ) {
    super(`Site ${siteId} data quota exceeded (need ${needed}B, quota ${quota}B)`);
    this.name = "SiteQuotaExceededError";
  }
}

export interface SiteBackendConfig {
  siteId: string;
  enabled: boolean;
  dataQuotaBytes: number;
}

export interface SiteDocumentRow {
  id: string;
  data: string;
  createdAt: Date;
}

const utf8Bytes = (s: string): number => Buffer.byteLength(s, "utf8");

// ---------------------------------------------------------------------------
// Tenant-scoped repository — siteId is ALWAYS the first arg
// ---------------------------------------------------------------------------

export const siteStore = {
  /** The backend config for a Site, or null when it has never been enabled. */
  async getConfig(siteId: string): Promise<SiteBackendConfig | null> {
    const row = await sitesDataDb.siteBackendConfig.findUnique({ where: { siteId } });
    return row
      ? { siteId, enabled: row.enabled, dataQuotaBytes: row.dataQuotaBytes }
      : null;
  },

  /** True iff the Site's backend master switch is on. */
  async isEnabled(siteId: string): Promise<boolean> {
    const row = await sitesDataDb.siteBackendConfig.findUnique({
      where: { siteId },
      select: { enabled: true },
    });
    return row?.enabled ?? false;
  },

  /** Create/update a Site's backend config (owner action, from the app side). */
  async setConfig(
    siteId: string,
    patch: { enabled?: boolean; dataQuotaBytes?: number },
  ): Promise<SiteBackendConfig> {
    const row = await sitesDataDb.siteBackendConfig.upsert({
      where: { siteId },
      create: {
        siteId,
        enabled: patch.enabled ?? false,
        ...(patch.dataQuotaBytes != null ? { dataQuotaBytes: patch.dataQuotaBytes } : {}),
      },
      update: {
        ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
        ...(patch.dataQuotaBytes != null ? { dataQuotaBytes: patch.dataQuotaBytes } : {}),
      },
    });
    return { siteId, enabled: row.enabled, dataQuotaBytes: row.dataQuotaBytes };
  },

  // ---- KV ----

  async kvGet(
    siteId: string,
    collection: string,
    key: string,
    scope = "shared",
  ): Promise<string | null> {
    const row = await sitesDataDb.siteKV.findUnique({
      where: { siteId_collection_key_scope: { siteId, collection, key, scope } },
      select: { value: true },
    });
    return row?.value ?? null;
  },

  /** Atomic quota-checked upsert of one KV entry. Returns the stored value. */
  async kvPut(
    siteId: string,
    collection: string,
    key: string,
    value: string,
    scope = "shared",
  ): Promise<string> {
    await this.assertQuota(siteId, value.length, async (tx, quota) => {
      const existing = await tx.siteKV.findUnique({
        where: { siteId_collection_key_scope: { siteId, collection, key, scope } },
        select: { value: true },
      });
      const oldBytes = existing ? utf8Bytes(existing.value) : 0;
      const delta = utf8Bytes(value) - oldBytes;
      await bumpUsage(tx, siteId, delta, existing ? 0 : 1, quota);
      await tx.siteKV.upsert({
        where: { siteId_collection_key_scope: { siteId, collection, key, scope } },
        create: { siteId, collection, key, value, scope },
        update: { value },
      });
    });
    return value;
  },

  async kvDelete(
    siteId: string,
    collection: string,
    key: string,
    scope = "shared",
  ): Promise<boolean> {
    return sitesDataDb.$transaction(async (tx) => {
      const existing = await tx.siteKV.findUnique({
        where: { siteId_collection_key_scope: { siteId, collection, key, scope } },
        select: { value: true },
      });
      if (!existing) return false;
      await tx.siteKV.delete({
        where: { siteId_collection_key_scope: { siteId, collection, key, scope } },
      });
      await bumpUsage(tx, siteId, -utf8Bytes(existing.value), -1, Number.MAX_SAFE_INTEGER);
      return true;
    });
  },

  // ---- Documents (append-only) ----

  /** Atomic quota-checked append of one document. Returns its id. */
  async docAppend(siteId: string, collection: string, data: string): Promise<string> {
    let id = "";
    await this.assertQuota(siteId, data.length, async (tx, quota) => {
      await bumpUsage(tx, siteId, utf8Bytes(data), 1, quota);
      const created = await tx.siteDocument.create({
        data: { siteId, collection, data },
        select: { id: true },
      });
      id = created.id;
    });
    return id;
  },

  /** Newest-first documents in a collection (owner/read-policy enforced upstream). */
  async docList(
    siteId: string,
    collection: string,
    limit = 100,
  ): Promise<SiteDocumentRow[]> {
    return sitesDataDb.siteDocument.findMany({
      where: { siteId, collection },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true, data: true, createdAt: true },
    });
  },

  /** Current usage counters for a Site (both 0 when it has never written). */
  async usage(siteId: string): Promise<{ bytes: number; rows: number }> {
    const row = await sitesDataDb.siteUsage.findUnique({ where: { siteId } });
    return { bytes: row?.bytes ?? 0, rows: row?.rows ?? 0 };
  },

  /** Delete ALL data for a Site (called from the app-side Site delete cascade). */
  async purgeSite(siteId: string): Promise<void> {
    await sitesDataDb.$transaction([
      sitesDataDb.siteKV.deleteMany({ where: { siteId } }),
      sitesDataDb.siteDocument.deleteMany({ where: { siteId } }),
      sitesDataDb.siteUsage.deleteMany({ where: { siteId } }),
      sitesDataDb.siteBackendConfig.deleteMany({ where: { siteId } }),
    ]);
  },

  /**
   * Run `body` inside a transaction after loading the Site's quota. `body`
   * receives the tx client and the quota; it must call `bumpUsage` to record its
   * byte/row delta (which throws SiteQuotaExceededError past the cap).
   */
  async assertQuota(
    siteId: string,
    _hint: number,
    body: (tx: TxClient, quota: number) => Promise<void>,
  ): Promise<void> {
    await ensureSitesData();
    const cfg = await sitesDataDb.siteBackendConfig.findUnique({
      where: { siteId },
      select: { dataQuotaBytes: true },
    });
    const quota = cfg?.dataQuotaBytes ?? 0;
    await sitesDataDb.$transaction(async (tx) => body(tx as TxClient, quota));
  },
};

// Prisma's interactive-transaction client type (the client minus the tx-control
// members). Kept local so the repository is the only place that sees it.
type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Adjust the denormalized SiteUsage counters by (deltaBytes, deltaRows) inside a
 * transaction, throwing SiteQuotaExceededError (which rolls the tx back) when the
 * resulting byte total would exceed `quota`. Negative deltas (deletes) never
 * throw and floor at 0.
 */
async function bumpUsage(
  tx: TxClient,
  siteId: string,
  deltaBytes: number,
  deltaRows: number,
  quota: number,
): Promise<void> {
  const current = await tx.siteUsage.findUnique({ where: { siteId } });
  const bytes = current?.bytes ?? 0;
  const rows = current?.rows ?? 0;
  const nextBytes = bytes + deltaBytes;
  if (deltaBytes > 0 && nextBytes > quota) {
    throw new SiteQuotaExceededError(siteId, nextBytes, quota);
  }
  const clampedBytes = Math.max(0, nextBytes);
  const clampedRows = Math.max(0, rows + deltaRows);
  await tx.siteUsage.upsert({
    where: { siteId },
    create: { siteId, bytes: clampedBytes, rows: clampedRows },
    update: { bytes: clampedBytes, rows: clampedRows },
  });
}
