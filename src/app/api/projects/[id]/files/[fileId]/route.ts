/**
 * DELETE /api/projects/[id]/files/[fileId] — remove one knowledge file from a
 * project. Auth required; the file must belong to a project the caller owns
 * (otherwise 404). The row is deleted and the on-disk upload is best-effort
 * unlinked.
 */
import { unlink } from "fs/promises";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string; fileId: string };
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  // Ownership: the file must live under a project owned by the caller.
  const file = await prisma.projectFile.findFirst({
    where: { id: params.fileId, projectId: params.id, project: { userId } },
  });
  if (!file) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  await prisma.projectFile.delete({ where: { id: file.id } });

  // Best-effort removal of the persisted upload; ignore failures (the row is
  // already gone, and a stray file under public/uploads is harmless).
  try {
    await unlink(path.join(process.cwd(), "public", file.url));
  } catch {
    // ignore — file may already be missing.
  }

  return Response.json({ success: true });
}
