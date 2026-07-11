/**
 * Server-only text extraction for project knowledge files. Given a file on disk
 * plus its MIME type, return the plain text we want to feed the model as project
 * context, or `null` when the file has no usable text (binary/unknown formats,
 * empty content, or any extraction failure). Never throws — callers store the
 * result directly on the ProjectFile row's `content` column.
 */
import { readFile } from "fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

/** Upper bound on stored extracted text, in characters (~200 KB of UTF-8). */
export const MAX_EXTRACTED_CHARS = 200_000;

/** MIME types we read verbatim as UTF-8 text. */
const TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/xml",
  "application/xml",
  "application/json",
]);

/**
 * Extract text from a project knowledge file. `filePath` is an absolute path on
 * disk; `mimeType` is the stored MIME type. Returns the extracted text capped at
 * {@link MAX_EXTRACTED_CHARS}, or `null` when there is nothing usable to store.
 */
export async function extractProjectFileText(
  filePath: string,
  mimeType: string,
): Promise<string | null> {
  try {
    const mime = (mimeType || "").toLowerCase();

    if (TEXT_MIME_TYPES.has(mime)) {
      const raw = await readFile(filePath, "utf-8");
      const text = raw.trim().slice(0, MAX_EXTRACTED_CHARS);
      return text.length > 0 ? text : null;
    }

    if (mime === "application/pdf") {
      const buf = await readFile(filePath);
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      // Collapse the runs of whitespace unpdf leaves between glyphs/pages.
      const normalized = text.replace(/\s+/g, " ").trim().slice(0, MAX_EXTRACTED_CHARS);
      return normalized.length > 0 ? normalized : null;
    }

    // docx, images, zip, and anything else: no text extraction.
    return null;
  } catch (err) {
    console.error(`Failed to extract text from ${filePath}:`, err);
    return null;
  }
}
