/**
 * OWNER control of a Site's mini-app backend master switch + quota (Phase 1-3
 * dashboard). Authenticated + ownership-checked. This is the in-product way to
 * enable the backend (replacing the enable-via-script crutch) and see usage.
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

const DEFAULT_QUOTA = 5 * 1024 * 1024;

/** GET /api/sites/[id]/backend — config + usage. */
export async function GET(_req: Request, { params }: RouteParams) {
  const owner = await requireOwner(params.id);
  if (owner instanceof Response) return owner;
  const config = await siteStore.getConfig(params.id);
  const usage = await siteStore.usage(params.id);
  return Response.json({
    enabled: config?.enabled ?? false,
    dataQuotaBytes: config?.dataQuotaBytes ?? DEFAULT_QUOTA,
    usage,
  });
}

/** PATCH /api/sites/[id]/backend — { enabled?, dataQuotaBytes? }. */
export async function PATCH(req: Request, { params }: RouteParams) {
  const owner = await requireOwner(params.id);
  if (owner instanceof Response) return owner;

  let body: { enabled?: unknown; dataQuotaBytes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, { status: 400 });
  }
  const patch: { enabled?: boolean; dataQuotaBytes?: number } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.dataQuotaBytes === "number" && body.dataQuotaBytes >= 0) {
    patch.dataQuotaBytes = Math.floor(body.dataQuotaBytes);
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" } satisfies ApiError, { status: 400 });
  }
  const config = await siteStore.setConfig(params.id, patch);
  const usage = await siteStore.usage(params.id);
  return Response.json({ enabled: config.enabled, dataQuotaBytes: config.dataQuotaBytes, usage });
}
