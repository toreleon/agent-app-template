/**
 * Storage helpers for uploaded files (owned by Agent D — Files).
 *
 * Files are written to `public/uploads` at the repo root so that Next.js serves
 * them statically at `/uploads/<name>`. The directory is created on demand.
 */

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import type { Attachment } from "@/lib/types";

/** Maximum allowed size per file, in bytes (20 MB). */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Allowed MIME types. Images plus common document formats. Empty/unknown MIME
 * types are rejected so we never persist arbitrary binaries.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  // NOTE: image/svg+xml is intentionally excluded. SVGs can carry inline
  // <script>; served same-origin from /uploads they are a stored-XSS vector.
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/json",
  "application/xml",
  "application/zip",
  "application/x-zip-compressed",
  // Text
  "text/plain",
  "text/markdown",
  "text/csv",
  // NOTE: text/html is intentionally excluded — same-origin active content
  // served from /uploads would execute as stored XSS.
  "text/xml",
]);

/** Absolute path to the directory uploaded files are written to. */
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/** Ensure the upload directory exists, creating it (recursively) if missing. */
async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

/**
 * Extract a safe, lowercase file extension (including the leading dot) from an
 * original filename. Returns an empty string when there is no usable extension.
 */
export function extractExtension(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  // Guard against absurdly long or path-bearing "extensions".
  if (!ext || ext.length > 12 || ext.includes("/") || ext.includes("\\")) {
    return "";
  }
  return ext;
}

/** Error thrown when a file fails validation (size or type). */
export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

/**
 * Validate a file's size and MIME type. Throws {@link FileValidationError} with
 * a human-readable message on rejection.
 */
export function validateFile(file: File): void {
  if (file.size === 0) {
    throw new FileValidationError(`File "${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_SIZE) {
    const limitMb = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    throw new FileValidationError(
      `File "${file.name}" exceeds the ${limitMb} MB size limit.`
    );
  }
  const mime = (file.type || "").toLowerCase();
  if (!mime || !ALLOWED_MIME_TYPES.has(mime)) {
    throw new FileValidationError(
      `File type "${file.type || "unknown"}" is not allowed for "${file.name}".`
    );
  }
}

/**
 * Persist a single uploaded file to `public/uploads` and return its
 * {@link Attachment}. The caller is responsible for validating first (or this
 * will validate again — validation is cheap and idempotent).
 */
export async function saveFile(file: File): Promise<Attachment> {
  validateFile(file);
  await ensureUploadDir();

  const ext = extractExtension(file.name);
  const storedName = `${nanoid()}${ext}`;
  const destPath = path.join(UPLOAD_DIR, storedName);

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(destPath, bytes);

  const type = file.type || "application/octet-stream";

  return {
    id: nanoid(),
    name: file.name,
    type,
    size: file.size,
    url: `/uploads/${storedName}`,
    kind: type.startsWith("image/") ? "image" : "file",
  };
}

/**
 * Validate and persist many files. Files are saved sequentially; if any file
 * fails validation the error propagates to the caller (already-saved files in
 * the same batch are left in place — the route returns 400 with the message).
 */
export async function saveFiles(files: File[]): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  for (const file of files) {
    attachments.push(await saveFile(file));
  }
  return attachments;
}
