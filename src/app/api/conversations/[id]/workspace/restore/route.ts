import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { restoreWorkspaceTo } from "@/lib/workspace/restore";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/conversations/[id]/workspace/restore  { messageId } — rewind the
 * confined workspace to the checkpoint captured at `messageId`. Auto-snapshots
 * the current state first (so the rewind is itself undoable), then does a
 * byte-exact git restore (or a degraded replay materialize when no snapshot
 * exists). Owner only. The conversation branch is moved separately by the
 * existing PATCH { activeLeafId }.
 *
 * Note: the client disables rewind while a run is streaming; disk writes are
 * additionally serialized via the workspace write-lock.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }

  let body: { messageId?: unknown };
  try {
    body = (await req.json()) as { messageId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  if (!messageId) {
    return Response.json({ error: "Missing messageId" } satisfies ApiError, {
      status: 400,
    });
  }

  const result = await restoreWorkspaceTo(
    params.id,
    session.user.id,
    messageId,
  );
  if (!result.ok) {
    return Response.json(
      { error: result.error ?? "Restore failed" } satisfies ApiError,
      { status: result.error === "Not found" ? 404 : 500 },
    );
  }
  return Response.json(result);
}
