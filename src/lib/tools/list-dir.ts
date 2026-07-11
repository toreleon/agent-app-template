import { tool } from "@openai/agents";
import { z } from "zod";
import fsp from "fs/promises";
import path from "path";
import {
  resolveInside,
  conversationIdFromContext,
  noWorkspaceResult,
  toToolError,
} from "@/lib/sandbox/confine";

/** Cap the number of entries returned so a huge directory can't blow context. */
const MAX_ENTRIES = 200;

type EntryType = "file" | "dir" | "symlink" | "other";

export const listDirTool = tool({
  name: "list_dir",
  description:
    "List the entries (name, type, size) of a directory in your workspace. " +
    "Cheaper and safer than run_shell('ls'). Paths are relative to and confined " +
    "within the workspace root; symlinks are reported by type but not followed.",
  parameters: z.object({
    path: z
      .string()
      .nullable()
      .describe("Directory path relative to the workspace root; null = root."),
  }),
  async execute({ path: relPath }, ctx) {
    const conversationId = conversationIdFromContext(ctx);
    if (!conversationId) return noWorkspaceResult();
    try {
      const rel = relPath ?? ".";
      const abs = resolveInside(conversationId, rel, { forWrite: false });

      let dirents;
      try {
        dirents = await fsp.readdir(abs, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOTDIR") {
          return {
            ok: false as const,
            code: "not_a_directory",
            error: `${rel} is not a directory; use read_file.`,
          };
        }
        return {
          ok: false as const,
          code: "not_found",
          error: `No such directory: ${rel}`,
        };
      }

      const entries = await Promise.all(
        dirents.map(async (d) => {
          const type: EntryType = d.isDirectory()
            ? "dir"
            : d.isSymbolicLink()
              ? "symlink"
              : d.isFile()
                ? "file"
                : "other";
          let size = 0;
          if (type === "file") {
            try {
              size = (await fsp.stat(path.join(abs, d.name))).size;
            } catch {
              // ignore stat failures (e.g. race)
            }
          }
          return { name: d.name, type, size };
        }),
      );

      // Directories first, then alphabetical by name.
      entries.sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });

      const truncated = entries.length > MAX_ENTRIES;
      return {
        ok: true as const,
        path: rel,
        count: entries.length,
        entries: entries.slice(0, MAX_ENTRIES),
        truncated,
      };
    } catch (err) {
      return toToolError(err);
    }
  },
});
