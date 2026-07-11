import { tool } from "@openai/agents";
import { z } from "zod";
import fsp from "fs/promises";
import path from "path";
import {
  resolveInside,
  getRecordedRead,
  recordRead,
  withWriteLock,
  atomicWrite,
  conversationIdFromContext,
  noWorkspaceResult,
  toToolError,
} from "@/lib/sandbox/confine";

/** Count non-overlapping occurrences of `needle` in `hay`. */
function countOccurrences(hay: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** 1-based line number of the byte at `index`. */
function lineOf(hay: string, index: number): number {
  return hay.slice(0, index).split("\n").length;
}

/** 1-based line numbers where each exact occurrence of `needle` begins. */
function occurrenceLines(hay: string, needle: string): number[] {
  const out: number[] = [];
  let idx = hay.indexOf(needle);
  while (idx !== -1 && out.length < 20) {
    out.push(lineOf(hay, idx));
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex matching `needle` where the ONLY tolerated differences from the
 * file are trailing whitespace per line and CRLF↔LF line endings. Leading
 * indentation is NOT relaxed — differing indentation usually means the model has
 * the wrong region, and silently editing it is worse than a clean failure.
 */
function buildLooseRegex(needle: string): RegExp {
  const lines = needle.split(/\r?\n/);
  const parts = lines.map((line, i) => {
    const body = escapeRegExp(line.replace(/[ \t]+$/, ""));
    // Relax trailing whitespace only at a real line boundary. Interior lines are
    // followed by a newline; the FINAL line must be followed by end-of-line or
    // end-of-file (lookahead), so a trailing-whitespace needle can't latch onto a
    // prefix of a longer line/token (e.g. "foo " must not match "foobar").
    return i < lines.length - 1 ? body + "[ \\t]*" : body + "[ \\t]*(?=\\r?\\n|$)";
  });
  return new RegExp(parts.join("\\r?\\n"), "g");
}

/** A compact unified-diff-style summary for the tool card (bounded in size). */
function miniDiff(
  relPath: string,
  oldStr: string,
  newStr: string,
  startLine: number,
): string {
  const cap = (s: string) => {
    const lines = s.split("\n");
    return lines.length > 40 ? lines.slice(0, 40).concat("… [truncated]") : lines;
  };
  const minus = cap(oldStr).map((l) => `-${l}`);
  const plus = cap(newStr).map((l) => `+${l}`);
  return [`--- a/${relPath}`, `+++ b/${relPath}`, `@@ line ${startLine} @@`, ...minus, ...plus].join(
    "\n",
  );
}

/**
 * Nearest-context diagnostics for a failed match: find the first non-blank line
 * of old_string in the current file (exact, then trimmed) and return those lines
 * ±3 with 1-based numbers, so the model sees the true current whitespace/tabs/
 * CRLF and can fix its old_string. Falls back to the file head.
 */
function nearestContext(original: string, oldStr: string): string {
  const fileLines = original.split("\n");
  const needleLines = oldStr.split("\n");
  const anchor = needleLines.find((l) => l.trim().length > 0);

  let hitIdx = -1;
  if (anchor) {
    hitIdx = fileLines.findIndex((l) => l === anchor);
    if (hitIdx === -1) {
      const t = anchor.trim();
      hitIdx = fileLines.findIndex((l) => l.trim() === t);
    }
  }

  const format = (from: number, to: number) =>
    fileLines
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(6, " ")}\t${l}`)
      .join("\n");

  if (hitIdx === -1) {
    return format(0, Math.min(fileLines.length, 15));
  }
  return format(Math.max(0, hitIdx - 3), Math.min(fileLines.length, hitIdx + 4));
}

export const editFileTool = tool({
  name: "edit_file",
  description:
    "PRIMARY editor: replace an exact, unique string in a file you have ALREADY " +
    "read this conversation. Copy old_string byte-for-byte from read_file output " +
    "(including whitespace, tabs, and newlines) but WITHOUT the leading line " +
    "number + tab. Include enough surrounding lines that old_string occurs " +
    "exactly once, or set replace_all to change every occurrence. Prefer this " +
    "over write_file for changes to existing files. If a match fails, the tool " +
    "shows the file's real current text near the target so you can fix old_string.",
  parameters: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    old_string: z
      .string()
      .describe(
        "The exact text to replace, copied from read_file output without the " +
          "line-number prefix. Must occur exactly once unless replace_all is true.",
      ),
    new_string: z.string().describe("The replacement text."),
    replace_all: z
      .boolean()
      .nullable()
      .describe(
        "When true, replace every occurrence of old_string; null/false requires " +
          "old_string to be unique.",
      ),
  }),
  async execute({ path: relPath, old_string, new_string, replace_all }, ctx) {
    const conversationId = conversationIdFromContext(ctx);
    if (!conversationId) return noWorkspaceResult();

    try {
      return await withWriteLock(conversationId, async () => {
        try {
        if (old_string.length === 0) {
          return {
            ok: false as const,
            code: "empty_old_string",
            error:
              "old_string must not be empty. To create a new file use write_file.",
          };
        }
        if (old_string === new_string) {
          return {
            ok: false as const,
            code: "noop",
            error: "old_string and new_string are identical; nothing to change.",
          };
        }

        const abs = resolveInside(conversationId, relPath, { forWrite: true });

        // --- Read-before-edit gate (runs BEFORE any string matching) ---
        let stat;
        try {
          stat = await fsp.stat(abs);
        } catch {
          return {
            ok: false as const,
            code: "not_found",
            error: `No such file: ${relPath}. Use write_file to create it.`,
          };
        }
        if (stat.isDirectory()) {
          return {
            ok: false as const,
            code: "is_directory",
            error: `${relPath} is a directory.`,
          };
        }
        const recordedMtime = getRecordedRead(conversationId, abs);
        if (recordedMtime === undefined) {
          return {
            ok: false as const,
            code: "unread",
            error: `Read ${relPath} with read_file before editing it.`,
          };
        }
        if (Math.abs(stat.mtimeMs - recordedMtime) > 0.5) {
          return {
            ok: false as const,
            code: "stale",
            error: `${relPath} changed on disk since you last read it. Re-read it with read_file, then edit.`,
          };
        }

        const original = await fsp.readFile(abs, "utf8");
        const wantAll = replace_all === true;

        // --- Exact match (never regex, never line-number-aware) ---
        const exactCount = countOccurrences(original, old_string);
        let updated: string;
        let replacements: number;
        let startLine: number;
        let normalizedMatch = false;

        if (exactCount === 1 || (exactCount > 1 && wantAll)) {
          const firstIdx = original.indexOf(old_string);
          startLine = lineOf(original, firstIdx);
          replacements = exactCount === 1 ? 1 : exactCount;
          updated =
            exactCount === 1
              ? original.slice(0, firstIdx) +
                new_string +
                original.slice(firstIdx + old_string.length)
              : original.split(old_string).join(new_string);
        } else if (exactCount > 1 && !wantAll) {
          return {
            ok: false as const,
            code: "not_unique",
            error: `old_string matches ${exactCount} places in ${relPath}.`,
            count: exactCount,
            occurrences: occurrenceLines(original, old_string),
            hint: "Add surrounding context to make old_string unique, or set replace_all: true.",
          };
        } else {
          // exactCount === 0 → one conservative retry: trailing-WS + CRLF↔LF.
          // Skip the loose retry for an all-whitespace needle: its relaxed
          // pattern would match the empty string everywhere and (with
          // replace_all) shred the file. Treat it as a clean no_match instead.
          if (old_string.replace(/[ \t\r\n]/g, "").length === 0) {
            return {
              ok: false as const,
              code: "no_match",
              error: `old_string not found in ${relPath} (whitespace-only strings are not matched loosely).`,
              nearest: nearestContext(original, old_string),
            };
          }
          const re = buildLooseRegex(old_string);
          const matches = [...original.matchAll(re)].filter(
            (m) => m[0].length > 0,
          );
          if (matches.length === 0) {
            return {
              ok: false as const,
              code: "no_match",
              error: `old_string not found in ${relPath}. The file's current text near the target is below — copy old_string from it exactly (mind tabs vs spaces and trailing whitespace).`,
              nearest: nearestContext(original, old_string),
            };
          }
          if (matches.length > 1 && !wantAll) {
            return {
              ok: false as const,
              code: "not_unique",
              error: `old_string matches ${matches.length} places in ${relPath} (ignoring trailing whitespace / line endings).`,
              count: matches.length,
              occurrences: matches.map((m) => lineOf(original, m.index ?? 0)),
              hint: "Add surrounding context to make old_string unique, or set replace_all: true.",
            };
          }
          normalizedMatch = true;
          startLine = lineOf(original, matches[0].index ?? 0);
          if (wantAll) {
            replacements = matches.length;
            updated = original.replace(re, () => new_string);
          } else {
            const m = matches[0];
            const at = m.index ?? 0;
            replacements = 1;
            updated =
              original.slice(0, at) + new_string + original.slice(at + m[0].length);
          }
        }

        await atomicWrite(abs, updated);
        // Refresh the recorded mtime so a follow-up edit passes the gate.
        const newStat = await fsp.stat(abs);
        recordRead(conversationId, abs, newStat.mtimeMs);

        return {
          ok: true as const,
          path: relPath,
          replacements,
          normalizedMatch,
          startLine,
          diff: miniDiff(path.basename(relPath), old_string, new_string, startLine),
        };
        } catch (err) {
          return toToolError(err);
        }
      });
    } catch (err) {
      return toToolError(err);
    }
  },
});
