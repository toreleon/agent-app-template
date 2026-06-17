import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import {
  DEFAULT_MODEL,
  MODELS,
  type ApiError,
  type ConversationSummary,
  type CreateConversationRequest,
} from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/conversations — list the current user's conversations, newest first. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, model: true, updatedAt: true },
  });

  const result: ConversationSummary[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    model: c.model,
    updatedAt: c.updatedAt.toISOString(),
  }));

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

  const created = await prisma.conversation.create({
    data: { title, model, userId },
    select: { id: true, title: true, model: true, updatedAt: true },
  });

  const summary: ConversationSummary = {
    id: created.id,
    title: created.title,
    model: created.model,
    updatedAt: created.updatedAt.toISOString(),
  };

  return Response.json(summary, { status: 201 });
}
