/**
 * Per-Site BLOB / file storage (Phase 3b). Files live under a per-site directory
 * (`<SITES_BLOB_DIR>/<siteId>/`) on the host disk, distinct from the app.
 *
 * Safety:
 *  - Keys are validated to a single safe filename (no `/`, no `..`), so a key can
 *    never traverse out of the site's directory; a defensive prefix check backs
 *    that up. siteId is a cuid, not attacker-controlled.
 *  - Bounded: a per-file byte cap AND a per-site file-count cap together bound a
 *    Site's total disk use (no unbounded growth).
 *  - Content-type is derived from the key EXTENSION and constrained to a small
 *    inert allowlist (images) served inline; everything else is served as
 *    application/octet-stream + attachment (never rendered) — see the route.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";

export const MAX_BLOB_BYTES = 2 * 1024 * 1024; // 2 MiB per file
const MAX_FILES = 100; // per site
const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

const IMAGE_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function blobRoot(): string {
  return process.env.SITES_BLOB_DIR || path.join(process.cwd(), ".sites-blob");
}
function siteDir(siteId: string): string {
  return path.join(blobRoot(), siteId);
}
function blobPath(siteId: string, key: string): string {
  const dir = siteDir(siteId);
  const p = path.join(dir, key);
  // Defensive: the resolved path must stay within the site's dir.
  if (p !== dir && !p.startsWith(dir + path.sep)) throw new Error("path escape");
  return p;
}

export function validBlobKey(key: string): boolean {
  return KEY_RE.test(key) && !key.includes("..");
}

/** Content-type to serve a key as — an inert image type, else octet-stream. */
export function contentTypeForKey(key: string): { type: string; inline: boolean } {
  const ext = path.extname(key).toLowerCase();
  const img = IMAGE_EXT[ext];
  return img ? { type: img, inline: true } : { type: "application/octet-stream", inline: false };
}

export type BlobPutResult = { ok: true } | { ok: false; code: number; error: string };

export async function putBlob(siteId: string, key: string, data: Buffer): Promise<BlobPutResult> {
  if (!validBlobKey(key)) return { ok: false, code: 400, error: "bad_key" };
  if (data.length > MAX_BLOB_BYTES) return { ok: false, code: 413, error: "too_large" };
  const dir = siteDir(siteId);
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir).catch(() => [] as string[]);
  if (!files.includes(key) && files.length >= MAX_FILES) {
    return { ok: false, code: 413, error: "too_many_files" };
  }
  await writeFile(blobPath(siteId, key), data);
  return { ok: true };
}

export async function getBlob(siteId: string, key: string): Promise<Buffer | null> {
  if (!validBlobKey(key)) return null;
  try {
    return await readFile(blobPath(siteId, key));
  } catch {
    return null;
  }
}

export async function deleteBlob(siteId: string, key: string): Promise<boolean> {
  if (!validBlobKey(key)) return false;
  try {
    await rm(blobPath(siteId, key), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Remove ALL of a Site's blobs (called from the Site delete cascade). */
export async function removeSiteBlobs(siteId: string): Promise<void> {
  await rm(siteDir(siteId), { recursive: true, force: true }).catch(() => {});
}
