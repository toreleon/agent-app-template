import { tool } from "@openai/agents";
import { z } from "zod";
import fsp from "fs/promises";
import {
  resolveInside,
  recordRead,
  conversationIdFromContext,
  noWorkspaceResult,
  toToolError,
} from "@/lib/sandbox/confine";

/** Character cap on returned content (mirrors web_fetch's DEFAULT_MAX_CHARS). */
const MAX_CHARS = 50_000;
/** Refuse whole-file reads above this byte size; steer to a slice or grep. */
const MAX_FILE_BYTES = 1_000_000;
/** Truncate any single very long line so one line can't blow the output cap. */
const MAX_LINE_CHARS = 2_000;

export const readFileTool = tool({
  name: "read_file",
  description:
    "Read a UTF-8 text file from your per-conversation workspace, returned with " +
    "1-based line numbers. Paths are RELATIVE to the workspace root and cannot " +
    "escape it. Reading a file also records it so you may then edit it with " +
    "edit_file. IMPORTANT: when copying text into edit_file's old_string, strip " +
    "the leading line number and tab — match only the content AFTER the tab.",
  parameters: z.object({
    path: z
      .string()
      .describe(
        "File path relative to the workspace root, e.g. 'src/index.ts'. " +
          "Absolute paths and paths that escape the workspace are rejected.",
      ),
    offset: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("1-based line to start reading from; null = start of file."),
    limit: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        "Max number of lines to return; null = as many as fit in the output cap.",
      ),
  }),
  async execute({ path: relPath, offset, limit }, ctx) {
    const conversationId = conversationIdFromContext(ctx);
    if (!conversationId) return noWorkspaceResult();
    try {
      const abs = resolveInside(conversationId, relPath, { forWrite: false });

      let stat;
      try {
        stat = await fsp.stat(abs);
      } catch {
        return {
          ok: false as const,
          code: "not_found",
          error: `No such file: ${relPath}`,
        };
      }
      if (stat.isDirectory()) {
        return {
          ok: false as const,
          code: "is_directory",
          error: `${relPath} is a directory; use list_dir to see its entries.`,
        };
      }
      if (stat.size > MAX_FILE_BYTES) {
        return {
          ok: false as const,
          code: "too_large",
          error:
            `File is ${stat.size} bytes (over ${MAX_FILE_BYTES}). Read a slice ` +
            "with offset/limit, or use grep_search to locate the relevant lines.",
        };
      }

      const raw = await fsp.readFile(abs, "utf8");
      // Record the read BEFORE slicing, keyed to the on-disk mtime, so edit_file's
      // read-before-edit gate can detect later out-of-band changes.
      recordRead(conversationId, abs, stat.mtimeMs);

      const lines = raw.split("\n");
      const totalLines = lines.length;
      const start = Math.max(1, offset ?? 1);
      const out: string[] = [];
      let shown = 0;
      let chars = 0;
      let truncated = false;

      for (let i = start - 1; i < totalLines; i++) {
        if (limit != null && shown >= limit) {
          truncated = true;
          break;
        }
        let content = lines[i];
        if (content.length > MAX_LINE_CHARS) {
          content = content.slice(0, MAX_LINE_CHARS) + "… [line truncated]";
        }
        const numbered = `${String(i + 1).padStart(6, " ")}\t${content}`;
        if (chars + numbered.length + 1 > MAX_CHARS) {
          truncated = true;
          break;
        }
        out.push(numbered);
        chars += numbered.length + 1;
        shown++;
      }

      return {
        ok: true as const,
        content: out.join("\n"),
        totalLines,
        offset: start,
        shown,
        truncated,
      };
    } catch (err) {
      return toToolError(err);
    }
  },
});
