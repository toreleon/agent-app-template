import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import {
  ensureAccessToken,
  toConnectorDTO,
  type McpServerRow,
} from "@/lib/mcp";
import { probeMcpServer } from "@/lib/mcp/client";
import * as oauth from "@/lib/mcp/oauth";
import { type ApiError, type McpConnectResponse } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

const redirectUri = `${process.env.NEXTAUTH_URL}/api/mcp/oauth/callback`;

/** POST /api/mcp/[id]/connect — re-probe a connector and (re)start OAuth. */
export async function POST(_req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, {
      status: 401,
    });
  }
  const userId = session.user.id;

  const row = (await prisma.mcpServer.findFirst({
    where: { id: params.id, userId },
  })) as McpServerRow | null;
  if (!row) {
    return Response.json({ error: "Not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const token = await ensureAccessToken(row);
  const probe = await probeMcpServer(row.url, token);

  if (probe.status === "connected") {
    const updated = await prisma.mcpServer.update({
      where: { id: row.id },
      data: {
        authStatus: "connected",
        toolsCache: JSON.stringify(probe.tools),
        lastError: null,
      },
    });
    const response: McpConnectResponse = {
      connector: toConnectorDTO(updated as McpServerRow),
    };
    return Response.json(response);
  }

  if (probe.status === "unauthorized") {
    // Reuse already-discovered metadata + registered client where present.
    let meta: oauth.OAuthMetadata | null = null;
    if (row.oauthMetadata) {
      try {
        meta = JSON.parse(row.oauthMetadata) as oauth.OAuthMetadata;
      } catch {
        meta = null;
      }
    }
    if (!meta) {
      meta = await oauth.discoverOAuth(row.url, probe.wwwAuthenticate);
    }
    if (!meta) {
      const updated = await prisma.mcpServer.update({
        where: { id: row.id },
        data: {
          authStatus: "error",
          lastError:
            "This connector requires authentication but no OAuth metadata could be discovered.",
        },
      });
      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
      };
      return Response.json(response);
    }

    try {
      let clientId = row.oauthClientId;
      let clientSecret = row.oauthClientSecret;
      if (!clientId) {
        const client = await oauth.registerClient(meta, redirectUri);
        clientId = client.clientId;
        clientSecret = client.clientSecret ?? null;
      }

      const pkce = oauth.generatePkce();
      const state = oauth.generateState();
      const scope = meta.scopesSupported?.length
        ? meta.scopesSupported.join(" ")
        : undefined;

      const updated = await prisma.mcpServer.update({
        where: { id: row.id },
        data: {
          authStatus: "pending",
          oauthClientId: clientId,
          oauthClientSecret: clientSecret,
          oauthMetadata: JSON.stringify(meta),
          pkceVerifier: pkce.verifier,
          oauthState: state,
          lastError: null,
        },
      });

      const authorizationUrl = oauth.buildAuthorizeUrl(meta, {
        clientId,
        redirectUri,
        state,
        codeChallenge: pkce.challenge,
        scope,
      });

      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
        authorizationUrl,
      };
      return Response.json(response);
    } catch (err) {
      const updated = await prisma.mcpServer.update({
        where: { id: row.id },
        data: {
          authStatus: "error",
          lastError: err instanceof Error ? err.message : "OAuth setup failed",
        },
      });
      const response: McpConnectResponse = {
        connector: toConnectorDTO(updated as McpServerRow),
      };
      return Response.json(response);
    }
  }

  // probe.status === "error"
  const updated = await prisma.mcpServer.update({
    where: { id: row.id },
    data: {
      authStatus: "error",
      lastError: probe.error,
    },
  });
  const response: McpConnectResponse = {
    connector: toConnectorDTO(updated as McpServerRow),
  };
  return Response.json(response);
}
