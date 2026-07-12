import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadWorkspaceOps } from "@/lib/workspace/load";
import { replay, changesForScope } from "@/lib/workspace/replay";
import { readWorkspaceTree } from "@/lib/workspace/tree";
import type { ApiError } from "@/lib/types";
import type { WorkspaceScope, WorkspaceStatus } from "@/lib/workspace/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/conversations/[id]/workspace — the coding-workspace review status:
 * the changed-files list (reconstructed from the agent's write_file/edit_file
 * tool calls) for the requested scope, plus the on-disk file tree for browse
 * mode. Read-only; owner of the conversation only.
 *
 * Query: ?scope=all|lastTurn  &messageId=<id> (for a specific turn's changes).
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

  const { events } = replay(ops);
  const changes = changesForScope(events, scope, scopeMsg);
  const tree = await readWorkspaceTree(params.id);

  const status: WorkspaceStatus = {
    changes,
    tree,
    scope,
    hasChanges: events.length > 0,
    lastTurnMessageId,
  };
  return Response.json(status);
}
