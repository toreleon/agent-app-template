"use client";

import { create } from "zustand";
import type {
  CreateMcpConnectorRequest,
  McpConnectResponse,
  McpConnector,
  UpdateMcpConnectorRequest,
} from "@/lib/types";

/** Shape of the message the OAuth callback page posts back via window.opener. */
interface McpOAuthMessage {
  type: "mcp:oauth";
  ok: boolean;
  id?: string;
  error?: string;
}

function isOAuthMessage(data: unknown): data is McpOAuthMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "mcp:oauth"
  );
}

/** Open the OAuth authorization URL in a centered popup window. */
function openOAuthPopup(url: string) {
  if (typeof window === "undefined") return;
  window.open(url, "mcp_oauth", "width=520,height=680");
}

/** Read an { error } body from a failed Response, falling back to a default. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}

export interface McpState {
  // ---- data ----
  connectors: McpConnector[];

  // ---- ui / status ----
  loading: boolean;
  error: string | null;

  // ---- actions ----
  load: () => Promise<void>;
  add: (req: CreateMcpConnectorRequest) => Promise<McpConnectResponse | null>;
  update: (id: string, patch: UpdateMcpConnectorRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  connectors: [],
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  load: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/mcp", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Failed to load connectors"));
      const data = (await res.json()) as McpConnector[];
      set({ connectors: data, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load connectors" });
    } finally {
      set({ loading: false });
    }
  },

  add: async (req) => {
    set({ error: null });
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add connector"));
      const data = (await res.json()) as McpConnectResponse;
      // Insert/replace the returned connector immediately, then open OAuth if needed.
      set((s) => ({
        connectors: upsert(s.connectors, data.connector),
      }));
      if (data.authorizationUrl) openOAuthPopup(data.authorizationUrl);
      return data;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to add connector" });
      return null;
    }
  },

  update: async (id, patch) => {
    // Optimistic update; revert on failure.
    const prev = get().connectors;
    set({
      connectors: prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
    try {
      const res = await fetch(`/api/mcp/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readError(res, "Update failed"));
      const updated = (await res.json()) as McpConnector;
      set((s) => ({ connectors: upsert(s.connectors, updated) }));
    } catch (e) {
      set({ connectors: prev, error: e instanceof Error ? e.message : "Update failed" });
    }
  },

  remove: async (id) => {
    const prev = get().connectors;
    set({ connectors: prev.filter((c) => c.id !== id) });
    try {
      const res = await fetch(`/api/mcp/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Delete failed"));
    } catch (e) {
      set({ connectors: prev, error: e instanceof Error ? e.message : "Delete failed" });
    }
  },

  reconnect: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/mcp/${id}/connect`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res, "Reconnect failed"));
      const data = (await res.json()) as McpConnectResponse;
      set((s) => ({ connectors: upsert(s.connectors, data.connector) }));
      if (data.authorizationUrl) openOAuthPopup(data.authorizationUrl);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Reconnect failed" });
    }
  },
}));

/** Replace a connector by id, or append it if not yet present. */
function upsert(list: McpConnector[], next: McpConnector): McpConnector[] {
  const exists = list.some((c) => c.id === next.id);
  return exists ? list.map((c) => (c.id === next.id ? next : c)) : [...list, next];
}

/**
 * Register a window "message" listener for the OAuth popup callback. The
 * callback page posts { type:"mcp:oauth", ok, id?, error? } via
 * window.opener.postMessage. On `ok` we invoke `reload` (typically the store's
 * `load`) so the connector flips to "connected"; on failure we surface the
 * error on the store. Returns an unsubscribe function — call it from a
 * useEffect cleanup. No-op (returns a noop) outside the browser.
 */
export function initMcpOAuthListener(reload: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  function onMessage(e: MessageEvent) {
    // Only trust messages from our own origin.
    if (e.origin !== window.location.origin) return;
    if (!isOAuthMessage(e.data)) return;
    if (e.data.ok) {
      reload();
    } else {
      useMcpStore.setState({
        error: e.data.error || "OAuth sign-in failed",
      });
    }
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
