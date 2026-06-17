import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { toConnectorDTO, type McpServerRow } from "@/lib/mcp";
import {
  type ApiError,
  type McpConnector,
  type UpdateMcpConnectorRequest,
} from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/** GET /api/mcp/[id] — fetch a single connector. */
export async function GET(_req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const row = await prisma.mcpServer.findFirst({
    where: { id: params.id, userId },
  });
  if (!row) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const connector: McpConnector = toConnectorDTO(row as McpServerRow);
  return Response.json(connector);
}

/** PATCH /api/mcp/[id] — update name/description/enabled/trusted. */
export async function PATCH(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  let body: UpdateMcpConnectorRequest;
  try {
    body = (await req.json()) as UpdateMcpConnectorRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  const existing = await prisma.mcpServer.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const data: {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    trusted?: boolean;
  } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return Response.json(
        { error: "Name must be a non-empty string" } satisfies ApiError,
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (typeof body?.description === "string") {
    const description = body.description.trim();
    data.description = description ? description : null;
  }
  if (typeof body?.enabled === "boolean") {
    data.enabled = body.enabled;
  }
  if (typeof body?.trusted === "boolean") {
    data.trusted = body.trusted;
  }

  const updated = await prisma.mcpServer.update({
    where: { id: params.id },
    data,
  });

  const connector: McpConnector = toConnectorDTO(updated as McpServerRow);
  return Response.json(connector);
}

/** DELETE /api/mcp/[id] — remove a connector. */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const existing = await prisma.mcpServer.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  await prisma.mcpServer.delete({ where: { id: params.id } });

  return Response.json({ success: true });
}
