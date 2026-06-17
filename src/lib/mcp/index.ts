import prisma from "@/lib/db";
import { RemoteMCPServer } from "./client";
import * as oauth from "./oauth";
import type { McpConnector, McpAuthStatus, McpToolInfo } from "@/lib/types";

/**
 * Structural shape of a Prisma `McpServer` row. Declared locally (rather than
 * importing Prisma's generated type) so this module stays decoupled from the
 * generated client surface. Mirrors prisma/schema.prisma.
 */
export interface McpServerRow {
  id: string;
  userId: string;
  name: string;
  url: string;
  description: string | null;
  enabled: boolean;
  trusted: boolean;
  authStatus: string;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthMetadata: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  pkceVerifier: string | null;
  oauthState: string | null;
  toolsCache: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseTools(toolsCache: string | null): McpToolInfo[] {
  if (!toolsCache) return [];
  try {
    const parsed = JSON.parse(toolsCache);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is { name: string; description?: unknown } =>
          !!t && typeof t === "object" && typeof t.name === "string",
      )
      .map((t) => ({
        name: t.name,
        description:
          typeof t.description === "string" ? t.description : undefined,
      }));
  } catch {
    return [];
  }
}

function asAuthStatus(value: string): McpAuthStatus {
  switch (value) {
    case "none":
    case "pending":
    case "connected":
    case "error":
      return value;
    default:
      return "pending";
  }
}

/**
 * Map a Prisma McpServer row to the sanitized {@link McpConnector} DTO returned
 * by the /api/mcp routes. Strips all OAuth secrets and tokens.
 */
export function toConnectorDTO(row: McpServerRow): McpConnector {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description ?? undefined,
    enabled: row.enabled,
    trusted: row.trusted,
    authStatus: asAuthStatus(row.authStatus),
    tools: parseTools(row.toolsCache),
    lastError: row.lastError ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Return a usable access token for a connector, refreshing it if expired.
 * Returns null when the connector has no access token at all. When the token is
 * expired (within a 30s skew) and a refresh token + OAuth metadata are present,
 * refreshes via the token endpoint and persists the new tokens to the row.
 */
export async function ensureAccessToken(
  row: McpServerRow,
): Promise<string | null> {
  if (!row.accessToken) return null;

  const skewMs = 30_000;
  const expired =
    row.tokenExpiresAt != null &&
    row.tokenExpiresAt.getTime() - skewMs <= Date.now();

  if (expired && row.refreshToken && row.oauthMetadata) {
    let meta: oauth.OAuthMetadata | null = null;
    try {
      meta = JSON.parse(row.oauthMetadata) as oauth.OAuthMetadata;
    } catch {
      meta = null;
    }
    if (meta) {
      try {
        const tokens = await oauth.refreshAccessToken(meta, {
          refreshToken: row.refreshToken,
          clientId: row.oauthClientId ?? "",
          clientSecret: row.oauthClientSecret ?? undefined,
        });
        const tokenExpiresAt =
          tokens.expiresInSec != null
            ? new Date(Date.now() + tokens.expiresInSec * 1000)
            : null;
        await prisma.mcpServer.update({
          where: { id: row.id },
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? row.refreshToken,
            tokenExpiresAt,
          },
        });
        return tokens.accessToken;
      } catch {
        // Refresh failed — fall through and return the (stale) current token;
        // a subsequent 401 will surface the auth error to the caller.
        return row.accessToken;
      }
    }
  }

  return row.accessToken;
}

/**
 * Build a {@link RemoteMCPServer} for each of a user's enabled + trusted +
 * connected connectors. Does NOT connect — the agent layer awaits connect()
 * before a run and close() after. Each server's getAccessToken re-fetches the
 * latest row so token refreshes performed by other requests are picked up.
 */
export async function loadUserMcpServers(
  userId: string,
): Promise<RemoteMCPServer[]> {
  const rows = await prisma.mcpServer.findMany({
    where: {
      userId,
      enabled: true,
      trusted: true,
      authStatus: "connected",
    },
  });

  return rows.map((row) => {
    const id = row.id;
    return new RemoteMCPServer({
      url: row.url,
      name: row.name,
      getAccessToken: async () => {
        const fresh = await prisma.mcpServer.findUnique({ where: { id } });
        if (!fresh) return null;
        return ensureAccessToken(fresh as McpServerRow);
      },
    });
  });
}
