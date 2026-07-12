/**
 * Server-side loader: turn a conversation's persisted messages into the ordered
 * list of file-writing tool calls along its ACTIVE branch (root → active leaf),
 * for {@link replay}. Also owns the lightweight ownership check the workspace
 * routes share.
 */
import prisma from "@/lib/db";
import type { ReplayOp } from "./replay";

/** True when `conversationId` exists and is owned by `userId`. */
export async function isConversationOwner(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  return !!c && c.userId === userId;
}

/** A file-writing tool call succeeded iff its output JSON has ok !== false. */
function toolSucceeded(output: unknown): boolean {
  if (output == null) return false;
  try {
    if (typeof output === "object") {
      const o = output as Record<string, unknown>;
      if (typeof o.text === "string") {
        const parsed = JSON.parse(o.text) as { ok?: unknown };
        return parsed?.ok !== false;
      }
      if ("ok" in o) return o.ok !== false;
    }
  } catch {
    // Unparseable output but the call ran — be lenient.
  }
  return true;
}

export interface LoadedWorkspace {
  found: boolean;
  ops: ReplayOp[];
  /** Most recent assistant message id that touched files, or null. */
  lastTurnMessageId: string | null;
}

/**
 * Load the file-writing ops (write_file/edit_file, successful only) along the
 * conversation's visible path, in order. Returns found:false when the
 * conversation is missing or not owned by `userId`.
 *
 * `upToMessageId` (optional) walks the path ending at that message instead of
 * the active leaf — i.e. reconstructs the workspace state AS OF that message
 * (used by the rewind preview + replay fallback). An invalid id falls back to
 * the active-leaf behavior.
 */
export async function loadWorkspaceOps(
  conversationId: string,
  userId: string,
  upToMessageId?: string,
): Promise<LoadedWorkspace> {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true, activeLeafId: true },
  });
  if (!convo || convo.userId !== userId) {
    return { found: false, ops: [], lastTurnMessageId: null };
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true, parentId: true, role: true, toolCalls: true, createdAt: true },
  });
  const byId = new Map(messages.map((m) => [m.id, m]));

  // Resolve the leaf to walk up from: an explicit target (rewind), else the
  // conversation's activeLeafId if valid, else the newest message. Then walk
  // parent links to root and reverse → the path ending at that leaf.
  let leaf: string | null =
    upToMessageId && byId.has(upToMessageId)
      ? upToMessageId
      : convo.activeLeafId && byId.has(convo.activeLeafId)
        ? convo.activeLeafId
        : messages.length > 0
          ? messages.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)).id
          : null;

  const path: typeof messages = [];
  const seen = new Set<string>();
  while (leaf && byId.has(leaf) && !seen.has(leaf)) {
    seen.add(leaf);
    const m = byId.get(leaf)!;
    path.push(m);
    leaf = m.parentId;
  }
  path.reverse();

  const ops: ReplayOp[] = [];
  let lastTurnMessageId: string | null = null;
  for (const m of path) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    let tc: unknown;
    try {
      tc = JSON.parse(m.toolCalls);
    } catch {
      continue;
    }
    if (!Array.isArray(tc)) continue;
    let touched = false;
    for (const t of tc as Array<Record<string, unknown>>) {
      const name = t?.name;
      if (name !== "write_file" && name !== "edit_file") continue;
      if (!toolSucceeded(t.output)) continue;
      ops.push({ messageId: m.id, name, args: t.args });
      touched = true;
    }
    if (touched) lastTurnMessageId = m.id;
  }

  return { found: true, ops, lastTurnMessageId };
}
