/**
 * Zero-dependency line-level diff (LCS) → structured unified hunks.
 *
 * Powers the coding-workspace diff viewer (Claude-Code-Desktop-style). We diff
 * two strings (a file's before/after content) into {@link DiffHunk}[] with a few
 * lines of surrounding context, exactly like `git diff -U3` — but computed in
 * pure JS from the agent's persisted write_file/edit_file tool calls, so no git
 * shell-out and no extra dependency.
 */

export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number in the OLD file, or null for an added line. */
  oldNo: number | null;
  /** 1-based line number in the NEW file, or null for a removed line. */
  newNo: number | null;
  /** The line text (no trailing newline). */
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** git-style `@@ -a,b +c,d @@` header. */
  header: string;
  lines: DiffLine[];
}

/** Split into lines, dropping a single trailing newline so a file ending in
 *  "\n" doesn't yield a spurious empty final line. */
function toLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Op = { type: DiffLineType; content: string };

/**
 * Classic LCS backtrack over the two line arrays → a flat op list
 * (context / del / add). O(n*m) time/space — fine for the modestly-sized files
 * a coding agent writes; callers guard on very large inputs.
 */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", content: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", content: a[i] });
      i++;
    } else {
      ops.push({ type: "add", content: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", content: a[i++] });
  while (j < m) ops.push({ type: "add", content: b[j++] });
  return ops;
}

/**
 * Diff `before` → `after` into unified hunks with `context` lines of surrounding
 * context (default 3), collapsing runs of unchanged lines between changes.
 * Returns [] when the two strings are identical.
 */
export function computeLineDiff(
  before: string,
  after: string,
  context = 3,
): DiffHunk[] {
  const a = toLines(before);
  const b = toLines(after);
  const ops = lcsOps(a, b);

  // Assign old/new line numbers to every op.
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.type === "context") {
      oldNo++;
      newNo++;
      lines.push({ type: "context", oldNo, newNo, content: op.content });
    } else if (op.type === "del") {
      oldNo++;
      lines.push({ type: "del", oldNo, newNo: null, content: op.content });
    } else {
      newNo++;
      lines.push({ type: "add", oldNo: null, newNo, content: op.content });
    }
  }

  // Which line indices are changes (add/del)?
  const changed = lines
    .map((l, idx) => (l.type === "context" ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changed.length === 0) return [];

  // Group changed indices into hunks, padding each side with `context` lines and
  // merging groups whose context windows touch/overlap.
  const hunks: DiffHunk[] = [];
  let groupStart = changed[0];
  let groupEnd = changed[0];
  const flush = () => {
    const start = Math.max(0, groupStart - context);
    const end = Math.min(lines.length - 1, groupEnd + context);
    const slice = lines.slice(start, end + 1);
    const firstOld = slice.find((l) => l.oldNo !== null)?.oldNo ?? 0;
    const firstNew = slice.find((l) => l.newNo !== null)?.newNo ?? 0;
    const oldCount = slice.filter((l) => l.oldNo !== null).length;
    const newCount = slice.filter((l) => l.newNo !== null).length;
    const oldStart = oldCount === 0 ? 0 : firstOld;
    const newStart = newCount === 0 ? 0 : firstNew;
    hunks.push({
      oldStart,
      oldLines: oldCount,
      newStart,
      newLines: newCount,
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: slice,
    });
  };
  for (let k = 1; k < changed.length; k++) {
    const idx = changed[k];
    // If the gap of context lines between this change and the previous group is
    // larger than 2*context, start a new hunk; else extend the current one.
    if (idx - groupEnd > context * 2 + 1) {
      flush();
      groupStart = idx;
    }
    groupEnd = idx;
  }
  flush();
  return hunks;
}

/** Total added / removed line counts across a file's hunks. */
export function diffStats(hunks: DiffHunk[]): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.type === "add") adds++;
      else if (l.type === "del") dels++;
    }
  }
  return { adds, dels };
}
