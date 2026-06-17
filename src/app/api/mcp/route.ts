import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { toConnectorDTO, type McpServerRow } from "@/lib/mcp";
import { probeMcpServer } from "@/lib/mcp/client";
import * as oauth from "@/lib/mcp/oauth";
import {
  type ApiError,
  type CreateMcpConnectorRequest,
  type McpConnectResponse,
  type McpConnector,
} from "@/lib/types";

export const runtime = "nodejs";

const redirectUri = `${process.env.NEXTAUTH_URL}/api/mcp/oauth/callback`;

/** GET /api/mcp — list the current user's connectors, newest first. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const rows = await prisma.mcpServer.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  const result: McpConnector[] = rows.map((row) =>
    toConnectorDTO(row as McpServerRow),
  );

  return Response.json(result);
}

/** POST /api/mcp — add a connector by URL, then probe / start OAuth. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  let body: CreateMcpConnectorRequest;
  try {
    body = (await req.json()) as CreateMcpConnectorRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  if (!name) {
    return Response.json(
      { error: "Name must be a non-empty string" } satisfies ApiError,
      { status: 400 },
    );
  }
  if (!url) {
    return Response.json(
      { error: "URL must be a non-empty string" } satisfies ApiError,
      { status: 400 },
    );
  }
  if (body?.trusted !== true) {
    return Response.json(
      {
        error: "You must trust the connector to add it",
      } satisfies ApiError,
      { status: 400 },
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return Response.json({ error: "Invalid URL" } satisfies ApiError, {
      status: 400,
    });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return Response.json(
      { error: "URL must use http or https" } satisfies ApiError,
      { status: 400 },
    );
  }

  const created = await prisma.mcpServer.create({
    data: {
      userId,
      name,
      url,
      description,
      trusted: true,
      authStatus: "pending",
    },
  });

  const probe = await probeMcpServer(url);

  if (probe.status === "connected") {
    const updated = await prisma.mcpServer.update({
      where: { id: created.id },
      data: {
        authStatus: "connected",
        toolsCache: JSON.stringify(probe.tools),
        lastError: null,
      },
    });
    const response: McpConnectResponse = {
      connector: toConnectorDTO(updated as McpServerRow),
    };
    return Response.json(response, { status: 201 });
  }

  if (probe.status === "unauthorized") {
    const meta = await oauth.discoverOAuth(url, probe.wwwAuthenticate);
    if (!meta) {
      const updated = await prisma.mcpServer.update({
        where: { id: created.id },
        data: {
          authStatus: "error",
          lastError:
            "This connector requires authentication but no OAuth metadata could be discovered.",
        },
      });
      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
      };
      return Response.json(response, { status: 201 });
    }

    try {
      const client = await oauth.registerClient(meta, redirectUri);
      const pkce = oauth.generatePkce();
      const state = oauth.generateState();
      const scope = meta.scopesSupported?.length
        ? meta.scopesSupported.join(" ")
        : undefined;

      const updated = await prisma.mcpServer.update({
        where: { id: created.id },
        data: {
          authStatus: "pending",
          oauthClientId: client.clientId,
          oauthClientSecret: client.clientSecret ?? null,
          oauthMetadata: JSON.stringify(meta),
          pkceVerifier: pkce.verifier,
          oauthState: state,
          lastError: null,
        },
      });

      const authorizationUrl = oauth.buildAuthorizeUrl(meta, {
        clientId: client.clientId,
        redirectUri,
        state,
        codeChallenge: pkce.challenge,
        scope,
      });

      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
        authorizationUrl,
      };
      return Response.json(response, { status: 201 });
    } catch (err) {
      const updated = await prisma.mcpServer.update({
        where: { id: created.id },
        data: {
          authStatus: "error",
          lastError: err instanceof Error ? err.message : "OAuth setup failed",
        },
      });
      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
      };
      return Response.json(response, { status: 201 });
    }
  }

  // probe.status === "error"
  const updated = await prisma.mcpServer.update({
    where: { id: created.id },
    data: {
      authStatus: "error",
      lastError: probe.error,
    },
  });
  const response: McpConnectResponse = {
    connector: toConnectorDTO(updated as McpServerRow),
  };
  return Response.json(response, { status: 201 });
}
