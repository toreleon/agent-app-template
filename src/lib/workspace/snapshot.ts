/**
 * Shadow-git snapshot store for "rewind code state".
 *
 * Each conversation gets a hidden git repo whose GIT_DIR lives OUTSIDE the
 * model-visible workspace — `.workspaces/<id>/.snap.git` with the work-tree
 * pointed at `.workspaces/<id>/repo`. We commit one snapshot per assistant turn
 * (keyed to the assistant message id via Message.snapshotSha); rewinding does a
 * byte-exact `git reset --hard <sha>` + `git clean -fd`, which — unlike replaying
 * the write_file/edit_file log — correctly restores run_shell-created files,
 * handles deletions, and removes files created after the checkpoint.
 *
 * Because the git-dir is a sibling of `repo/` (not under it): the model can't
 * read or corrupt it, confine.ts's `.git` write-protection doesn't block it, and
 * `git clean` on the work-tree never touches it. Every call is best-effort and
 * never throws — a snapshot failure must not break the chat SSE stream, and a
 * restore failure degrades to the replay fallback in restore.ts.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { getWorkspace, withWriteLock } from "@/lib/sandbox/confine";

const execFileP = promisify(execFile);

/** gitignore-style patterns kept out of snapshots (deps + build caches). Mirrors
 *  tree.ts SKIP_DIRS so snapshots stay small and restore never churns deps. */
const SNAPSHOT_EXCLUDES = [
  "node_modules/",
  "__pycache__/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".venv/",
  ".next/",
  "dist/",
  "build/",
  "*.pyc",
  ".DS_Store",
];

/** The shadow git-dir sits beside `repo/`, never inside it. */
function snapDirFor(realRoot: string): string {
  return path.join(path.dirname(realRoot), ".snap.git");
}

/** Run a git command against the shadow store, hermetically (no user/system
 *  config, no prompts, no hooks). Throws on non-zero exit. */
async function git(
  gitDir: string,
  workTree: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileP("git", args, {
    cwd: workTree,
    env: {
      ...process.env,
      GIT_DIR: gitDir,
      GIT_WORK_TREE: workTree,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Identity + hook/signing overrides applied per commit (no persistent config). */
const COMMIT_FLAGS = [
  "-c",
  "user.email=agent@local",
  "-c",
  "user.name=Workspace Snapshot",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=",
];

/** Init the shadow store on first use (idempotent). Caller holds the write lock. */
async function ensureStore(
  conversationId: string,
): Promise<{ gitDir: string; workTree: string }> {
  const { realRoot } = getWorkspace(conversationId);
  const gitDir = snapDirFor(realRoot);
  try {
    await fs.access(path.join(gitDir, "HEAD"));
    return { gitDir, workTree: realRoot };
  } catch {
    // not initialized yet
  }
  await git(gitDir, realRoot, ["init", "-q"]);
  await fs.mkdir(path.join(gitDir, "info"), { recursive: true });
  await fs.writeFile(
    path.join(gitDir, "info", "exclude"),
    SNAPSHOT_EXCLUDES.join("\n") + "\n",
    "utf8",
  );
  return { gitDir, workTree: realRoot };
}

/** True once the shadow store exists (a rewind can only target an existing one). */
export async function hasSnapshotStore(conversationId: string): Promise<boolean> {
  const { realRoot } = getWorkspace(conversationId);
  try {
    await fs.access(path.join(snapDirFor(realRoot), "HEAD"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit the current workspace tree as a snapshot; returns the commit sha, or
 * null on any failure (git missing, etc.). `label` is the commit message (the
 * assistant message id for a turn checkpoint, or a marker for pre-rewind undo).
 */
export async function snapshotTurn(
  conversationId: string,
  label: string,
): Promise<string | null> {
  return withWriteLock(conversationId, async () => {
    try {
      const { gitDir, workTree } = await ensureStore(conversationId);
      await git(gitDir, workTree, ["add", "-A"]);
      await git(gitDir, workTree, [
        ...COMMIT_FLAGS,
        "commit",
        "--allow-empty",
        "-q",
        "--no-verify",
        "-m",
        label,
      ]);
      return await git(gitDir, workTree, ["rev-parse", "HEAD"]);
    } catch {
      return null;
    }
  });
}

/**
 * Byte-exactly restore the workspace to snapshot `sha`: `reset --hard` (tracked
 * files match the snapshot; files added after it are removed) then `clean -fd`
 * (drop untracked, non-ignored files). Returns false if the sha is unknown or
 * git fails (caller falls back to replay). Caller must have already captured an
 * undo snapshot of the current state.
 */
export async function restoreTo(
  conversationId: string,
  sha: string,
): Promise<boolean> {
  return withWriteLock(conversationId, async () => {
    try {
      const { gitDir, workTree } = await ensureStore(conversationId);
      // Confirm the sha resolves to a commit in this store.
      await git(gitDir, workTree, ["cat-file", "-e", `${sha}^{commit}`]);
      await git(gitDir, workTree, ["reset", "-q", "--hard", sha]);
      await git(gitDir, workTree, ["clean", "-fdq"]);
      return true;
    } catch {
      return false;
    }
  });
}
