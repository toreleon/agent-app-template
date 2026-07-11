import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

/**
 * DELETE /api/user/sessions — "Log out of all devices". Clears any persisted
 * NextAuth Session rows for the user. (This app uses the JWT strategy, so most
 * sessions are stateless cookies; the client also calls signOut() to end the
 * current device — together this is the best-effort log-out-everywhere.)
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  await prisma.session.deleteMany({ where: { userId: session.user.id } });
  return Response.json({ success: true });
}
