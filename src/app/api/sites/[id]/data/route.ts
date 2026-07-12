/**
 * OWNER view + moderation of a Site's mini-app data (KV, documents, accounts).
 * Authenticated + ownership-checked. Read to inspect what visitors have stored;
 * DELETE to moderate (remove a KV entry or a document).
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { siteStore } from "@/lib/sites/data-db";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

async function requireOwner(siteId: string): Promise<string | Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  const owned = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) return Response.json({ error: "Not found" } satisfies ApiError, { status: 404 });
  return session.user.id;
}

/** GET /api/sites/[id]/data — KV rows, documents, and account list. */
export async function GET(_req: Request, { params }: RouteParams) {
  const owner = await requireOwner(params.id);
  if (owner instanceof Response) return owner;
  const [kv, documents, accounts] = await Promise.all([
    siteStore.listKVRows(params.id),
    siteStore.listDocumentRows(params.id),
    siteStore.listAccounts(params.id),
  ]);
  return Response.json({
    kv: kv.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    accounts: accounts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
}

/**
 * DELETE /api/sites/[id]/data — moderate one row.
 *  ?type=doc&id=<docId>
 *  ?type=kv&collection=<c>&key=<k>&scope=<scope>
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const owner = await requireOwner(params.id);
  if (owner instanceof Response) return owner;
  const q = new URL(req.url).searchParams;
  const type = q.get("type");
  if (type === "doc") {
    const id = q.get("id") ?? "";
    const ok = await siteStore.deleteDocument(params.id, id);
    return Response.json({ success: ok });
  }
  if (type === "kv") {
    const collection = q.get("collection") ?? "";
    const key = q.get("key") ?? "";
    const scope = q.get("scope") ?? "shared";
    const ok = await siteStore.kvDelete(params.id, collection, key, scope);
    return Response.json({ success: ok });
  }
  return Response.json({ error: "Invalid delete request" } satisfies ApiError, { status: 400 });
}
