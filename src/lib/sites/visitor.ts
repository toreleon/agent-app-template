/**
 * Per-visitor identity for a Site's mini-app backend (Phase 2).
 *
 * Because each published Site is served on its OWN origin (<slug>.<SITES_DOMAIN>,
 * Phase 0), it can carry its own cookie without ever touching the app session.
 * We mint an opaque, stateless visitor TOKEN and set it as an httpOnly, host-only
 * cookie on the Site's origin. The token IS the identity: private data is stored
 * under the scope `visitor:<token>` (see siteStore + SiteKV.scope), so no
 * server-side session table is needed. Cookies are per-origin, so a visitor's
 * identity is automatically per-Site.
 *
 * The token is httpOnly (JS can't read it) so the site's own untrusted JS can't
 * exfiltrate it; the page instead learns a NON-secret, derived visitor id via
 * GET /api/me. `__Host-` + Secure are used over https (prod); dev http drops them
 * so the cookie still sets.
 */
import { createHash, randomBytes } from "crypto";

const COOKIE_BASE = "sv";
const TOKEN_RE = /^[a-f0-9]{32}$/;
const ONE_YEAR = 60 * 60 * 24 * 365;

function isSecure(): boolean {
  return (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
}

function cookieName(): string {
  return isSecure() ? `__Host-${COOKIE_BASE}` : COOKIE_BASE;
}

/** Read + validate the visitor token from the request cookie, or null. */
export function readVisitorToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const name = cookieName().replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  const val = m?.[1];
  return val && TOKEN_RE.test(val) ? val : null;
}

/** Mint a fresh opaque visitor token (32 hex chars). */
export function newVisitorToken(): string {
  return randomBytes(16).toString("hex");
}

/** Build the Set-Cookie header value for a visitor token. */
export function visitorSetCookie(token: string): string {
  const parts = [
    `${cookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ONE_YEAR}`,
  ];
  if (isSecure()) parts.push("Secure");
  return parts.join("; ");
}

/** The storage scope for a visitor's private data. */
export function visitorScope(token: string): string {
  return `visitor:${token}`;
}

/**
 * A stable, NON-secret public id derived from the (secret) token — safe to hand
 * to the page's JS via GET /api/me so it can label "you" without ever seeing the
 * httpOnly cookie value.
 */
export function visitorPublicId(token: string): string {
  return createHash("sha256").update(`sv:${token}`).digest("hex").slice(0, 16);
}
