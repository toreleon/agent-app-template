import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { toProjectSummary } from "@/lib/projects/dto";
import {
  type ApiError,
  type CreateProjectRequest,
  isProjectIconName,
  type ProjectSummary,
} from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/projects — this user's projects, newest first, with counts. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { conversations: true, files: true } } },
  });

  const summaries: ProjectSummary[] = projects.map((project) =>
    toProjectSummary(project, {
      conversations: project._count.conversations,
      files: project._count.files,
    }),
  );

  return Response.json(summaries);
}

/** POST /api/projects — create a project. name required (400 if empty). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  let body: CreateProjectRequest;
  try {
    body = (await req.json()) as CreateProjectRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json(
      { error: "Name must be a non-empty string" } satisfies ApiError,
      { status: 400 },
    );
  }

  // Optional text fields: trim and store null when empty.
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const instructions =
    typeof body?.instructions === "string" ? body.instructions.trim() : "";
  if (body.icon !== undefined && !isProjectIconName(body.icon)) {
    return Response.json({ error: "Invalid project icon" } satisfies ApiError, {
      status: 400,
    });
  }

  const project = await prisma.project.create({
    data: {
      userId,
      name,
      icon: body.icon ?? "folder",
      description: description || null,
      instructions: instructions || null,
    },
  });

  // A freshly created project has no conversations or files yet.
  const summary = toProjectSummary(project);
  return Response.json(summary, { status: 201 });
}
