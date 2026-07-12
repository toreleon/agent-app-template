/**
 * Server-side disk reads for the workspace BROWSE mode: the full on-disk file
 * tree and a single file's text. Diffs come from tool-call replay; browsing
 * reads the real confined workspace so shell-created files are visible too.
 */
import fs from "fs/promises";
import path from "path";
import { getWorkspace, resolveInside } from "@/lib/sandbox/confine";
import type { WorkspaceTreeFile } from "./types";

/** Dirs never shown in the browse tree (noise / not the agent's source). */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".home",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
]);
/** Safety cap so a runaway workspace can't build an unbounded tree. */
const MAX_FILES = 2000;
/** Max size we'll read into memory for the browse view. Larger files are
 *  reported as `tooLarge` instead of allocated (avoids an OOM DoS). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Recursive walk of the confined workspace → flat, sorted file list. */
export async function readWorkspaceTree(
  conversationId: string,
): Promise<WorkspaceTreeFile[]> {
  const { realRoot } = getWorkspace(conversationId);
  const out: WorkspaceTreeFile[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith(".sandbox-tmp") || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, r);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(abs);
          out.push({ path: r, size: st.size });
        } catch {
          // vanished between readdir and stat — skip
        }
      }
    }
  }

  await walk(realRoot, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Read one confined file as text. Returns null on confinement/read failure.
 *  Files over {@link MAX_FILE_BYTES} are reported `tooLarge` WITHOUT being read
 *  into memory, so a huge (e.g. run_shell-created) file can't OOM the process. */
export async function readWorkspaceFile(
  conversationId: string,
  relPath: string,
): Promise<{ content: string; binary: boolean; tooLarge: boolean } | null> {
  let abs: string;
  try {
    abs = resolveInside(conversationId, relPath, { forWrite: false });
  } catch {
    return null;
  }
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return null;
    if (st.size > MAX_FILE_BYTES) {
      return { content: "", binary: false, tooLarge: true };
    }
    const buf = await fs.readFile(abs);
    // Binary sniff: a NUL byte in the first 8 KiB.
    const binary = buf.subarray(0, 8192).includes(0);
    return { content: binary ? "" : buf.toString("utf8"), binary, tooLarge: false };
  } catch {
    return null;
  }
}
