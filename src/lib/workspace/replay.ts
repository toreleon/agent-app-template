/**
 * Reconstruct workspace diffs by REPLAYING the agent's persisted write_file /
 * edit_file tool calls (server-side).
 *
 * Every successful file-writing tool call is persisted on its assistant message
 * (ChatMessage.toolCalls) with full args — write_file carries the whole new
 * `content`; edit_file carries `old_string`/`new_string`. Replaying them in
 * conversation order reconstructs, for each file, the exact before/after content
 * at every step, from which we compute git-style red/green diffs — no git
 * shell-out, no workspace mutation, no changes to the hot sandbox/chat code.
 *
 * (run_shell can also touch files; those changes are intentionally NOT shown as
 * diffs here — they surface in the on-disk browse tree instead.)
 */
import {
  computeLineDiff,
  diffStats,
  type DiffHunk,
} from "@/lib/diff/lineDiff";
import type {
  FileStatus,
  WorkspaceFileChange,
  WorkspaceFileDiff,
  WorkspaceScope,
} from "./types";

/** One file-writing op along the conversation's active path, in order. */
export interface ReplayOp {
  messageId: string;
  name: "write_file" | "edit_file";
  args: unknown;
}

function str(o: unknown, k: string): string | undefined {
  if (o && typeof o === "object" && k in o) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}
function bool(o: unknown, k: string): boolean {
  return !!(o && typeof o === "object" && (o as Record<string, unknown>)[k] === true);
}

/**
 * Apply an edit_file replacement to `before` by literal substring match — never
 * via String.prototype.replace, whose `$`-patterns in the replacement would
 * corrupt content that legitimately contains `$$` / `$&` (shell PIDs, template
 * literals, regex). Replaces the first occurrence (or all when replace_all).
 * Returns null when the old text isn't present in the reconstructed content
 * (e.g. the file was changed out-of-band via run_shell); the caller then skips
 * the op rather than fabricating a diff.
 */
function applyEdit(
  before: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): string | null {
  if (oldStr === "") return null;
  const i = before.indexOf(oldStr);
  if (i < 0) return null;
  if (replaceAll) return before.split(oldStr).join(newStr);
  return before.slice(0, i) + newStr + before.slice(i + oldStr.length);
}

/** One reconstructed before→after transition for a file at a message. */
interface Event {
  messageId: string;
  path: string;
  before: string;
  after: string;
}

/** Replay ops into a per-file event timeline + final content map. */
export function replay(ops: ReplayOp[]): {
  events: Event[];
  /** Latest reconstructed content per path (may drift if an edit couldn't be
   *  applied; the API prefers on-disk content where available). */
  final: Map<string, string>;
} {
  const cur = new Map<string, string>();
  const events: Event[] = [];
  for (const op of ops) {
    const path = str(op.args, "path");
    if (!path) continue;
    const before = cur.get(path) ?? "";
    let after: string;
    if (op.name === "write_file") {
      after = str(op.args, "content") ?? "";
    } else {
      const oldS = str(op.args, "old_string") ?? "";
      const newS = str(op.args, "new_string") ?? "";
      const applied = applyEdit(before, oldS, newS, bool(op.args, "replace_all"));
      // Can't locate old_string in the reconstructed content (file changed
      // out-of-band, or a prior op drifted): skip this op entirely rather than
      // overwrite the file's real reconstructed content with a tiny region —
      // which would collapse the whole file's diff to just the snippet.
      if (applied === null) continue;
      after = applied;
    }
    events.push({ messageId: op.messageId, path, before, after });
    cur.set(path, after);
  }
  return { events, final: cur };
}

/** Reduce the event timeline to (before,after) per path for a given scope. */
function scopedBounds(
  events: Event[],
  scope: WorkspaceScope,
  messageId?: string,
): Map<string, { before: string; after: string }> {
  const rel =
    scope === "lastTurn" && messageId
      ? events.filter((e) => e.messageId === messageId)
      : events;
  const bounds = new Map<string, { before: string; after: string }>();
  for (const e of rel) {
    const b = bounds.get(e.path);
    if (b) b.after = e.after;
    else bounds.set(e.path, { before: e.before, after: e.after });
  }
  return bounds;
}

function statusOf(before: string, after: string): FileStatus {
  if (before === "" && after !== "") return "A";
  if (after === "" && before !== "") return "D";
  return "M";
}

/** Changed-files summary for the given scope. */
export function changesForScope(
  events: Event[],
  scope: WorkspaceScope,
  messageId?: string,
): WorkspaceFileChange[] {
  const bounds = scopedBounds(events, scope, messageId);
  const out: WorkspaceFileChange[] = [];
  for (const [path, { before, after }] of bounds) {
    if (before === after) continue;
    const { adds, dels } = diffStats(computeLineDiff(before, after));
    // Skip changes with no line-level diff (e.g. only a trailing-newline toggle)
    // so they don't show as a bogus empty-diff entry.
    if (adds === 0 && dels === 0) continue;
    out.push({ path, status: statusOf(before, after), adds, dels });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby", go: "go",
  rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp", cs: "csharp",
  php: "php", swift: "swift", kt: "kotlin", scala: "scala", sh: "bash",
  bash: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", md: "markdown", html: "xml", xml: "xml",
  css: "css", scss: "scss", sql: "sql",
};

export function languageForPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXT_LANG[ext] : undefined;
}

/** Full diff for one path in a scope; null when that path had no change. */
export function diffForPath(
  events: Event[],
  path: string,
  scope: WorkspaceScope,
  messageId?: string,
): WorkspaceFileDiff | null {
  const bounds = scopedBounds(events, scope, messageId).get(path);
  if (!bounds || bounds.before === bounds.after) return null;
  const hunks: DiffHunk[] = computeLineDiff(bounds.before, bounds.after);
  if (hunks.length === 0) return null; // e.g. only a trailing-newline toggle
  const { adds, dels } = diffStats(hunks);
  return {
    path,
    status: statusOf(bounds.before, bounds.after),
    adds,
    dels,
    language: languageForPath(path),
    hunks,
  };
}
