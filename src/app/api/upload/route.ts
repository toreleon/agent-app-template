/**
 * POST /api/upload — upload one or more files/images. Auth required.
 *
 * Request: multipart/form-data with one or more parts under the field name
 * "files". Each file is validated (size + MIME type) and persisted under
 * `public/uploads`. Returns `{ attachments: Attachment[] }`.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { saveFiles, validateFile, FileValidationError } from "@/lib/storage";
import type { ApiError, UploadResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json(
      { error: "Unauthorized" } satisfies ApiError,
      { status: 401 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data request body." } satisfies ApiError,
      { status: 400 }
    );
  }

  // Collect every "files" entry that is a File (browsers may append several).
  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return Response.json(
      { error: 'No files provided under the "files" field.' } satisfies ApiError,
      { status: 400 }
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
      return Response.json(
        { error: err.message } satisfies ApiError,
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const attachments = await saveFiles(files);
    return Response.json(
      { attachments } satisfies UploadResponse,
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof FileValidationError) {
      return Response.json(
        { error: err.message } satisfies ApiError,
        { status: 400 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to save uploaded files.";
    return Response.json(
      { error: message } satisfies ApiError,
      { status: 500 }
    );
  }
}
