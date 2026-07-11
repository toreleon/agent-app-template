import { tool } from "@openai/agents";
import { z } from "zod";
import fsp from "fs/promises";
import path from "path";
import {
  resolveInside,
  hasRead,
  recordRead,
  withWriteLock,
  atomicWrite,
  conversationIdFromContext,
  noWorkspaceResult,
  toToolError,
} from "@/lib/sandbox/confine";

/** Refuse very large whole-file writes; steer the model to edit_file instead. */
const MAX_LINES = 1_500;

export const writeFileTool = tool({
  name: "write_file",
  description:
    "Create a NEW file, or fully overwrite an existing one (no append, no merge). " +
    "Use this ONLY to create new files, or when edit_file repeatedly cannot match. " +
    "For changes to an existing file, prefer edit_file. You must have read an " +
    "existing file (read_file) before overwriting it. Parent directories are " +
    "created as needed. Paths are relative to and confined within the workspace.",
  parameters: z.object({
    path: z
      .string()
      .describe("File path relative to the workspace root, e.g. 'src/new.ts'."),
    content: z.string().describe("The full file content to write."),
  }),
  async execute({ path: relPath, content }, ctx) {
    const conversationId = conversationIdFromContext(ctx);
    if (!conversationId) return noWorkspaceResult();

    try {
      return await withWriteLock(conversationId, async () => {
        try {
        const lineCount = content.split("\n").length;
        if (lineCount > MAX_LINES) {
          return {
            ok: false as const,
            code: "too_large",
            error: `content is ${lineCount} lines (over ${MAX_LINES}). Split it into smaller files, or build it up with edit_file.`,
          };
        }

        const abs = resolveInside(conversationId, relPath, { forWrite: true });

        let exists = false;
        try {
          const stat = await fsp.stat(abs);
          exists = true;
          if (stat.isDirectory()) {
            return {
              ok: false as const,
              code: "is_directory",
              error: `${relPath} is a directory.`,
            };
          }
        } catch {
          exists = false;
        }

        if (exists && !hasRead(conversationId, abs)) {
          return {
            ok: false as const,
            code: "overwrite_unread",
            error: `${relPath} already exists. Read it with read_file before overwriting it (write_file replaces the whole file).`,
          };
        }

        await fsp.mkdir(path.dirname(abs), { recursive: true });
        // Atomic (temp + rename) so a concurrent read_file/grep_search never sees
        // a truncated file, and a symlinked target is replaced, not followed.
        await atomicWrite(abs, content);
        const stat = await fsp.stat(abs);
        // Record so a subsequent edit_file passes the read-before-edit gate.
        recordRead(conversationId, abs, stat.mtimeMs);

        return {
          ok: true as const,
          path: relPath,
          created: !exists,
          bytesWritten: Buffer.byteLength(content, "utf8"),
          lines: lineCount,
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
