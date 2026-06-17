import prisma from "@/lib/db";
import { type McpServerRow } from "@/lib/mcp";
import { probeMcpServer } from "@/lib/mcp/client";
import * as oauth from "@/lib/mcp/oauth";

export const runtime = "nodejs";

const redirectUri = `${process.env.NEXTAUTH_URL}/api/mcp/oauth/callback`;

/** App origin used as the postMessage targetOrigin. */
function appOrigin(): string {
  try {
    return process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).origin
      : "*";
  } catch {
    return "*";
  }
}

/**
 * Render a minimal self-contained HTML page that posts the OAuth result back to
 * the window that opened the popup, then closes itself. Values are injected via
 * JSON.stringify so they are safely escaped inside the inline script.
 */
function resultPage(payload: {
  ok: boolean;
  id?: string;
  error?: string;
}): Response {
  // Escape `<` so a server-supplied error string can't break out of the inline
  // <script> with a `</script>` sequence (JSON.stringify alone does not escape it).
  const safe = (v: unknown) =>
    JSON.stringify(v).replace(/</g, "\\u003c");
  const message = safe({ type: "mcp:oauth", ...payload });
  const origin = safe(appOrigin());
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Connector authorization</title></head>
  <body style="font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 24px;">
    <p>You can close this window.</p>
    <script>
      (function () {
        try {
          if (window.opener) {
            window.opener.postMessage(${message}, ${origin});
          }
        } catch (e) {}
        window.close();
      })();
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** GET /api/mcp/oauth/callback — OAuth 2.1 authorization-code redirect target. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return resultPage({ ok: false, error: errorParam });
  }
  if (!code || !state) {
    return resultPage({ ok: false, error: "Missing authorization code or state" });
  }

  const row = (await prisma.mcpServer.findFirst({
    where: { oauthState: state },
  })) as McpServerRow | null;

  if (!row) {
    return resultPage({ ok: false, error: "Unknown or expired authorization state" });
  }

  let meta: oauth.OAuthMetadata | null = null;
  if (row.oauthMetadata) {
    try {
      meta = JSON.parse(row.oauthMetadata) as oauth.OAuthMetadata;
    } catch {
      meta = null;
    }
  }
  if (!meta || !row.pkceVerifier || !row.oauthClientId) {
    await prisma.mcpServer.update({
      where: { id: row.id },
      data: {
        authStatus: "error",
        lastError: "OAuth state is incomplete; please reconnect.",
        oauthState: null,
        pkceVerifier: null,
      },
    });
    return resultPage({ ok: false, error: "OAuth state is incomplete" });
  }

  try {
    const tokens = await oauth.exchangeCode(meta, {
      code,
      clientId: row.oauthClientId,
      clientSecret: row.oauthClientSecret ?? undefined,
      redirectUri,
      codeVerifier: row.pkceVerifier,
    });

    const tokenExpiresAt =
      tokens.expiresInSec != null
        ? new Date(Date.now() + tokens.expiresInSec * 1000)
        : null;

    await prisma.mcpServer.update({
      where: { id: row.id },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt,
        pkceVerifier: null,
        oauthState: null,
        lastError: null,
      },
    });

    const probe = await probeMcpServer(row.url, tokens.accessToken);
    if (probe.status === "connected") {
      await prisma.mcpServer.update({
        where: { id: row.id },
        data: {
          authStatus: "connected",
          toolsCache: JSON.stringify(probe.tools),
          lastError: null,
        },
      });
      return resultPage({ ok: true, id: row.id });
    }

    const lastError =
      probe.status === "error"
        ? probe.error
        : "Authorization completed but the connector is still unauthorized.";
    await prisma.mcpServer.update({
      where: { id: row.id },
      data: { authStatus: "error", lastError },
    });
    return resultPage({ ok: false, id: row.id, error: lastError });
  } catch (err) {
    const lastError =
      err instanceof Error ? err.message : "Token exchange failed";
    await prisma.mcpServer.update({
      where: { id: row.id },
      data: {
        authStatus: "error",
        lastError,
        pkceVerifier: null,
        oauthState: null,
      },
    });
    return resultPage({ ok: false, id: row.id, error: lastError });
  }
}
