import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listEnabledSkills, builtinSkillItems } from "@/lib/plugins";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/skills — the composer's `/` slash-command menu source: the app's
 *  built-in commands (Deep Research) first, then the user's enabled skills
 *  (flattened across enabled plugins). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  const builtins = builtinSkillItems();
  const builtinNames = new Set(builtins.map((b) => b.name));
  // A built-in command wins its name (matchBuiltinCommand precedes
  // resolveSlashSkill in the chat route), so drop a same-named plugin skill from
  // the menu rather than showing an unreachable duplicate.
  const skills = (await listEnabledSkills(session.user.id)).filter(
    (s) => !builtinNames.has(s.name),
  );
  return Response.json([...builtins, ...skills]);
}
