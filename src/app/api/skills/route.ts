import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listEnabledSkills } from "@/lib/plugins";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/skills — the current user's enabled skills (flattened across
 *  enabled plugins), for the composer's `/` slash-command menu. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  const skills = await listEnabledSkills(session.user.id);
  return Response.json(skills);
}
