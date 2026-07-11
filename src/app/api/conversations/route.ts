import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { toConversationSummary } from "@/lib/conversations";
import {
  DEFAULT_MODEL,
  MODELS,
  type ApiError,
  type ConversationSummary,
  type CreateConversationRequest,
} from "@/lib/types";

export const runtime = "nodejs";

/**
 * GET /api/conversations — list the current user's conversations, newest first.
 * Optional `?projectId=<id>` filters to a single project's conversations.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const projectId = new URL(req.url).searchParams.get("projectId");

  const conversations = await prisma.conversation.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      model: true,
      projectId: true,
      updatedAt: true,
    },
  });

  const result: ConversationSummary[] = conversations.map(toConversationSummary);

  return Response.json(result);
}

/** POST /api/conversations — create an empty conversation. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  let body: CreateConversationRequest = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      body = parsed as CreateConversationRequest;
    }
  } catch {
    // Empty/invalid body is allowed for create; fall back to defaults.
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "New chat";

  const model =
    typeof body.model === "string" && MODELS.some((m) => m.id === body.model)
      ? body.model
      : DEFAULT_MODEL;

  // Optional project membership — only honored when the project is owned by the
  // user; an unknown/unowned id is ignored (conversation created without one).
  let projectId: string | null = null;
  if (typeof body.projectId === "string" && body.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, userId },
      select: { id: true },
    });
    projectId = project?.id ?? null;
  }

  const created = await prisma.conversation.create({
    data: { title, model, userId, projectId },
    select: {
      id: true,
      title: true,
      model: true,
      projectId: true,
      updatedAt: true,
    },
  });

  const summary: ConversationSummary = toConversationSummary(created);

  return Response.json(summary, { status: 201 });
}
