import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadWorkspaceOps } from "@/lib/workspace/load";
import { replay, changesForScope, diffForPath } from "@/lib/workspace/replay";
import type { ApiError } from "@/lib/types";
import type { WorkspaceScope, WorkspaceFileDiff } from "@/lib/workspace/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/conversations/[id]/workspace/diff — one file's diff (?path=…), or all
 * changed files' diffs when `path` is omitted (for expand-all). Scope + message
 * mirror the status route. Read-only; owner only.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }

  const { ops, found, lastTurnMessageId } = await loadWorkspaceOps(
    params.id,
    session.user.id,
  );
  if (!found) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const url = new URL(req.url);
  const scope: WorkspaceScope =
    url.searchParams.get("scope") === "lastTurn" ? "lastTurn" : "all";
  const requestedMsg = url.searchParams.get("messageId") ?? undefined;
  const scopeMsg =
    scope === "lastTurn"
      ? requestedMsg ?? lastTurnMessageId ?? undefined
      : undefined;
  const path = url.searchParams.get("path");

  const { events } = replay(ops);

  if (path) {
    const diff = diffForPath(events, path, scope, scopeMsg);
    return Response.json({ diff });
  }

  // No path → every changed file's diff, for expand-all.
  const diffs = changesForScope(events, scope, scopeMsg)
    .map((c) => diffForPath(events, c.path, scope, scopeMsg))
    .filter((d): d is WorkspaceFileDiff => d !== null);
  return Response.json({ diffs });
}
