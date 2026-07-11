import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

/** DELETE /api/user/chats — permanently delete ALL of the user's conversations. */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  // Messages + artifacts cascade via their real FKs.
  const { count } = await prisma.conversation.deleteMany({
    where: { userId: session.user.id },
  });
  return Response.json({ success: true, deleted: count });
}
