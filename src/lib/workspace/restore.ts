/**
 * Orchestrates a "rewind code state" restore of the confined workspace to the
 * checkpoint captured at a target assistant message.
 *
 * Faithful path (a snapshot sha exists): snapshot the CURRENT tree first (so the
 * rewind is itself undoable), then `git reset --hard <sha>` + `git clean -fd` —
 * byte-exact, incl. run_shell-created files + deletions.
 *
 * Degraded fallback (no snapshot — pre-feature turn, or the snapshot failed):
 * reconstruct the tracked files from the write_file/edit_file replay log and
 * materialize them, deleting files that were created after the checkpoint. This
 * cannot restore run_shell-created bytes and is flagged `degraded`.
 */
import fs from "fs/promises";
import path from "path";
import {
  atomicWrite,
  resolveInside,
  removeInside,
} from "@/lib/sandbox/confine";
import { isConversationOwner, loadWorkspaceOps } from "./load";
import { replay } from "./replay";
import { readWorkspaceTree } from "./tree";
import { getSnapshotSha } from "./checkpoints";
import { snapshotTurn, restoreTo, changeCountBetween } from "./snapshot";

export interface RestoreResult {
  ok: boolean;
  /** True when the replay fallback was used (no real snapshot — lossy). */
  degraded: boolean;
  restored: number;
  deleted: number;
  /** Paths that couldn't be written/deleted (best-effort per-path). */
  skipped: string[];
  /** Snapshot sha of the pre-rewind state, so the rewind can itself be undone. */
  preSha: string | null;
  error?: string;
}

export interface RestorePreview {
  /** Files restored to their checkpoint content. */
  overwrite: string[];
  /** Files created after the checkpoint — removed by the restore. */
  delete: string[];
  /** On-disk files not in the change log (e.g. run_shell output); with a real
   *  snapshot git handles these, with the fallback they're left alone. */
  untrackedLeftAlone: string[];
  /** Whether a byte-exact snapshot exists (else the restore is degraded/lossy). */
  hasSnapshot: boolean;
}

/** Reconstruct the tracked {path -> content} map as of `upTo` (or current). */
async function trackedFinal(
  conversationId: string,
  userId: string,
  upTo?: string,
): Promise<Map<string, string> | null> {
  const { found, ops } = await loadWorkspaceOps(conversationId, userId, upTo);
  if (!found) return null;
  return replay(ops).final;
}

/** Confined write of one reconstructed file (creates parent dirs). */
async function writeConfined(
  conversationId: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = resolveInside(conversationId, relPath, { forWrite: true });
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWrite(abs, content);
}

/** Read-only preview of a prospective restore (no disk mutation). */
export async function previewRestore(
  conversationId: string,
  userId: string,
  targetMessageId: string,
): Promise<RestorePreview | null> {
  const target = await trackedFinal(conversationId, userId, targetMessageId);
  if (!target) return null;
  const current = (await trackedFinal(conversationId, userId)) ?? new Map();

  const targetPaths = new Set(target.keys());
  const overwrite = [...targetPaths].sort();
  const del = [...current.keys()].filter((p) => !targetPaths.has(p)).sort();

  const tracked = new Set([...target.keys(), ...current.keys()]);
  const tree = await readWorkspaceTree(conversationId);
  const untrackedLeftAlone = tree
    .map((f) => f.path)
    .filter((p) => !tracked.has(p))
    .sort();

  const hasSnapshot = (await getSnapshotSha(targetMessageId)) !== null;
  return { overwrite, delete: del, untrackedLeftAlone, hasSnapshot };
}

/** Restore the workspace to `targetMessageId`'s checkpoint. */
export async function restoreWorkspaceTo(
  conversationId: string,
  userId: string,
  targetMessageId: string,
): Promise<RestoreResult> {
  const base: RestoreResult = {
    ok: false,
    degraded: false,
    restored: 0,
    deleted: 0,
    skipped: [],
    preSha: null,
  };
  if (!(await isConversationOwner(conversationId, userId))) {
    return { ...base, error: "Not found" };
  }

  // Undo-safety: snapshot the current tree before we touch anything.
  const preSha = await snapshotTurn(conversationId, "pre-rewind");

  // Counts for the response (cheap, read-only) — also the fallback's work-list.
  const target = await trackedFinal(conversationId, userId, targetMessageId);
  if (!target) return { ...base, error: "Not found" };
  const current = (await trackedFinal(conversationId, userId)) ?? new Map();
  const targetPaths = new Set(target.keys());
  const toDelete = [...current.keys()].filter((p) => !targetPaths.has(p));

  // Faithful path: a real snapshot exists → git reset --hard + clean.
  const sha = await getSnapshotSha(targetMessageId);
  if (sha && (await restoreTo(conversationId, sha))) {
    // Count from the git diff between the pre-restore snapshot and the target —
    // accurate across branches + for run_shell files (the replay counts above
    // only see the active branch's tracked files). Fall back to replay counts.
    const counts =
      preSha !== null
        ? await changeCountBetween(conversationId, preSha, sha)
        : null;
    return {
      ok: true,
      degraded: false,
      restored: counts?.restored ?? targetPaths.size,
      deleted: counts?.deleted ?? toDelete.length,
      skipped: [],
      preSha,
    };
  }

  // Degraded fallback: materialize tracked files from the replay log.
  const skipped: string[] = [];
  let restored = 0;
  let deleted = 0;
  for (const [p, content] of target) {
    try {
      await writeConfined(conversationId, p, content);
      restored++;
    } catch {
      skipped.push(p);
    }
  }
  for (const p of toDelete) {
    try {
      await removeInside(conversationId, p);
      deleted++;
    } catch {
      skipped.push(p);
    }
  }
  return { ok: true, degraded: true, restored, deleted, skipped, preSha };
}
