import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isConversationOwner } from "@/lib/workspace/load";
import { readWorkspaceFile } from "@/lib/workspace/tree";
import { languageForPath } from "@/lib/workspace/replay";
import type { ApiError } from "@/lib/types";
import type { WorkspaceFileContent } from "@/lib/workspace/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/conversations/[id]/workspace/file?path=… — the current text of one
 * confined workspace file, for browse mode. Read-only; owner only; the path is
 * confined via resolveInside() inside readWorkspaceFile.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  if (!(await isConversationOwner(params.id, session.user.id))) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const relPath = new URL(req.url).searchParams.get("path");
  if (!relPath) {
    return Response.json({ error: "Missing path" } satisfies ApiError, {
      status: 400,
    });
  }

  const file = await readWorkspaceFile(params.id, relPath);
  if (!file) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const body: WorkspaceFileContent = {
    path: relPath,
    content: file.content,
    language: languageForPath(relPath),
    binary: file.binary,
    tooLarge: file.tooLarge,
  };
  return Response.json(body);
}
