import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { previewRestore } from "@/lib/workspace/restore";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/conversations/[id]/workspace/restore/preview?messageId=… — read-only
 * preview of a prospective rewind: which files get overwritten, which get
 * deleted, which on-disk files are left alone, and whether a byte-exact snapshot
 * exists (else the restore is degraded). No disk mutation. Owner only.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const messageId = new URL(req.url).searchParams.get("messageId");
  if (!messageId) {
    return Response.json({ error: "Missing messageId" } satisfies ApiError, {
      status: 400,
    });
  }
  const preview = await previewRestore(params.id, session.user.id, messageId);
  if (!preview) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }
  return Response.json(preview);
}
