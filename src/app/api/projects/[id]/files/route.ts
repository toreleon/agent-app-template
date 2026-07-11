/**
 * Knowledge files for a project.
 *
 *   POST /api/projects/[id]/files — upload one or more files (multipart, field
 *     "files"). Each file is validated + persisted under `public/uploads`, its
 *     text is extracted for model context, and a ProjectFile row is created.
 *   GET  /api/projects/[id]/files — list the project's knowledge files.
 *
 * Auth required; a project the user does not own returns 404 (never 403).
 */
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { saveFiles, validateFile, FileValidationError } from "@/lib/storage";
import { toProjectFileInfo } from "@/lib/projects/dto";
import { extractProjectFileText } from "@/lib/projects/extract";
import {
  MAX_PROJECT_FILES,
  type ApiError,
  type ProjectFileInfo,
  type UploadProjectFilesResponse,
} from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/** POST /api/projects/[id]/files — upload knowledge files. */
export async function POST(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  // Ownership check plus the current file count for the limit enforcement.
  const project = await prisma.project.findFirst({
    where: { id: params.id, userId },
    include: { _count: { select: { files: true } } },
  });
  if (!project) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data request body." } satisfies ApiError,
      { status: 400 },
    );
  }

  // Collect every "files" entry that is a File (browsers may append several).
  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return Response.json(
      { error: 'No files provided under the "files" field.' } satisfies ApiError,
      { status: 400 },
    );
  }

  if (project._count.files + files.length > MAX_PROJECT_FILES) {
    return Response.json(
      {
        error: `A project can hold at most ${MAX_PROJECT_FILES} knowledge files.`,
      } satisfies ApiError,
      { status: 400 },
    );
  }

  // Validate all files up front so we reject the whole batch atomically before
  // writing anything to disk.
  try {
    for (const file of files) {
      validateFile(file);
    }
  } catch (err) {
    if (err instanceof FileValidationError) {
      return Response.json({ error: err.message } satisfies ApiError, {
        status: 400,
      });
    }
    throw err;
  }

  try {
    const attachments = await saveFiles(files);

    // Persist a ProjectFile per attachment, extracting text for model context.
    const created = [];
    for (const attachment of attachments) {
      const filePath = path.join(process.cwd(), "public", attachment.url);
      const content = await extractProjectFileText(filePath, attachment.type);
      const row = await prisma.projectFile.create({
        data: {
          projectId: project.id,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          url: attachment.url,
          content,
        },
      });
      created.push(row);
    }

    return Response.json(
      { files: created.map(toProjectFileInfo) } satisfies UploadProjectFilesResponse,
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof FileValidationError) {
      return Response.json({ error: err.message } satisfies ApiError, {
        status: 400,
      });
    }
    const message =
      err instanceof Error ? err.message : "Failed to save uploaded files.";
    return Response.json({ error: message } satisfies ApiError, {
      status: 500,
    });
  }
}

/** GET /api/projects/[id]/files — the project's knowledge files, newest first. */
export async function GET(_req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!project) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const files = await prisma.projectFile.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
  });

  const infos: ProjectFileInfo[] = files.map(toProjectFileInfo);
  return Response.json(infos);
}
