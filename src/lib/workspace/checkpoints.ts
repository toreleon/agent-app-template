/**
 * DB-backed map from an assistant message id to its shadow-git snapshot sha
 * (Message.snapshotSha). Read from the DB, never from the in-memory workspace
 * state (which is LRU-evicted), so a rewind survives eviction + reloads.
 */
import prisma from "@/lib/db";

/** Persist the snapshot sha captured at the end of `messageId`'s turn. */
export async function setSnapshotSha(
  messageId: string,
  sha: string,
): Promise<void> {
  try {
    await prisma.message.update({
      where: { id: messageId },
      data: { snapshotSha: sha },
    });
  } catch {
    // best-effort — a missing message (deleted mid-flight) must not throw
  }
}

/** The snapshot sha for `messageId`, or null when it has none (pre-feature
 *  turn, or the snapshot failed → caller uses the replay fallback). */
export async function getSnapshotSha(
  messageId: string,
): Promise<string | null> {
  try {
    const m = await prisma.message.findUnique({
      where: { id: messageId },
      select: { snapshotSha: true },
    });
    return m?.snapshotSha ?? null;
  } catch {
    return null;
  }
}
