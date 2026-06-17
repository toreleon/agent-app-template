/**
 * Shared TypeScript types used across the entire ChatGPT clone.
 * Every agent imports the relevant symbols from "@/lib/types".
 */

// ---------------------------------------------------------------------------
// Core chat primitives
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant" | "system" | "tool";

/** A file or image attached to a message. */
export interface Attachment {
  id: string;
  name: string;
  /** MIME type, e.g. "image/png" or "application/pdf". */
  type: string;
  /** Size in bytes. */
  size: number;
  /** Public URL to fetch the file (e.g. "/uploads/<id>.png"). */
  url: string;
  /** Coarse classification used by the UI to decide how to render. */
  kind: "image" | "file";
}

/** A record of a tool invocation and (optionally) its result. */
export interface ToolCallRecord {
  /** Stable id correlating a call to its result. */
  id: string;
  name: string;
  /** JSON-serializable arguments passed to the tool. */
  args: unknown;
  /** JSON-serializable output, present once the tool has returned. */
  output?: unknown;
}

/** A single chat message as used on the client and serialized over the API. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: Attachment[];
  toolCalls?: ToolCallRecord[];
  /**
   * The model's reasoning summary text (assistant messages only). Accumulated
   * from `reasoning_delta` stream events and persisted so the "Thinking" block
   * survives reloads. Absent when the model produced no reasoning summary.
   */
  reasoning?: string;
  /** How long the model spent producing the reasoning summary, in milliseconds. */
  reasoningMs?: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Conversations & models
// ---------------------------------------------------------------------------

/** Lightweight conversation entry for the sidebar list. */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Full conversation with its messages. */
export interface ConversationDetail extends ConversationSummary {
  /** ISO 8601 timestamp. */
  createdAt: string;
  messages: ChatMessage[];
}

/** A selectable model in the model picker. */
export interface AvailableModel {
  id: string;
  label: string;
  description: string;
}

/** The list of models exposed in the UI. `id` values are passed verbatim to the agent. */
export const MODELS: AvailableModel[] = [
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Fast, capable model for most tasks",
  },
];

// NOTE: The server resolves the effective model from the OPENAI_MODEL env var
// when set (see src/lib/agent.ts), so this list is what the picker displays;
// the deployment name in OPENAI_MODEL is authoritative for the actual request.

/** Default model used when none is selected. */
export const DEFAULT_MODEL = MODELS[0].id;

// ---------------------------------------------------------------------------
// Reasoning effort
// ---------------------------------------------------------------------------

/**
 * Reasoning effort levels the user can select alongside the model.
 *
 * VERIFIED (2026-06-17) against the configured Azure endpoint with the
 * effective model `gpt-5.4-mini` (deployment `gpt-5.4-mini-2026-03-17`):
 * the model REJECTS `'minimal'` with a 400 (`unsupported_value`) and accepts
 * `'none' | 'low' | 'medium' | 'high' | 'xhigh'`. We expose the four standard
 * ChatGPT-style tiers below (`low | medium | high`) plus `minimal`, which the
 * SDK/OpenAI types allow but THIS model rejects — see the comment on `minimal`.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** A selectable reasoning-effort tier for the UI picker. */
export interface ReasoningEffortOption {
  id: ReasoningEffort;
  label: string;
  description: string;
  /**
   * False when the effective model is known to reject this value (the server
   * never sends a rejected value — it falls back to DEFAULT_EFFORT). The UI may
   * hide or disable unsupported options.
   */
  supported: boolean;
}

/**
 * Reasoning-effort tiers shown in the picker, ChatGPT-style.
 *
 * NOTE: `minimal` is marked `supported: false` because the verified effective
 * model (`gpt-5.4-mini`) 400s on it. It is kept in the type/list so the picker
 * compiles uniformly and so other (future) models that DO support it work; the
 * server must coerce an unsupported value to DEFAULT_EFFORT before sending.
 */
export const REASONING_EFFORTS: ReasoningEffortOption[] = [
  {
    id: "minimal",
    label: "Instant",
    description: "Answer immediately with little to no reasoning",
    supported: false,
  },
  {
    id: "low",
    label: "Light",
    description: "Quick answers with a little thinking",
    supported: true,
  },
  {
    id: "medium",
    label: "Standard",
    description: "Balanced reasoning for most tasks",
    supported: true,
  },
  {
    id: "high",
    label: "Thinking harder",
    description: "Deeper reasoning for complex problems",
    supported: true,
  },
];

/** Default reasoning effort. `medium` is supported by the effective model. */
export const DEFAULT_EFFORT: ReasoningEffort = "medium";

// ---------------------------------------------------------------------------
// SSE streaming protocol (POST /api/chat)
// ---------------------------------------------------------------------------

/**
 * Events streamed from POST /api/chat.
 * Wire format: each event is sent as a single SSE line: `data: <json>\n\n`.
 */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "reasoning_done" }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "message_id"; id: string }
  | { type: "title"; title: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// API request/response bodies
// ---------------------------------------------------------------------------

/** Request body for POST /api/chat. */
export interface ChatRequest {
  /** Existing conversation to append to. If omitted, the server creates one. */
  conversationId?: string;
  /** The user's message text. */
  message: string;
  /** Model id (one of MODELS[].id). */
  model: string;
  /** Optional attachments uploaded via POST /api/upload. */
  attachments?: Attachment[];
  /**
   * Reasoning effort for this turn. Flows ChatRequest.effort -> streamChat ->
   * Agent modelSettings.providerData.reasoning. Defaults to DEFAULT_EFFORT when
   * omitted; the server coerces unsupported values to DEFAULT_EFFORT.
   */
  effort?: ReasoningEffort;
}

/** Request body for POST /api/register. */
export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

/** Request body for POST /api/conversations. */
export interface CreateConversationRequest {
  /** Optional initial title. Defaults to "New chat". */
  title?: string;
  /** Model id; defaults to DEFAULT_MODEL. */
  model?: string;
}

/** Request body for PATCH /api/conversations/[id]. */
export interface UpdateConversationRequest {
  title: string;
}

/** Response body for POST /api/upload. */
export interface UploadResponse {
  attachments: Attachment[];
}

/** Generic error response shape returned by JSON (non-stream) routes. */
export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// MCP connectors (remote MCP servers, ChatGPT-style)
// ---------------------------------------------------------------------------

/**
 * Connection/authorization state of a connector.
 * - "none"      — server needs no auth and isn't connected yet (transient)
 * - "pending"   — awaiting OAuth sign-in (an authorizationUrl was issued)
 * - "connected" — initialized; tools discovered and usable
 * - "error"     — last connect/list/call failed (see `lastError`)
 */
export type McpAuthStatus = "none" | "pending" | "connected" | "error";

/** A tool discovered on an MCP server, surfaced in the connector UI. */
export interface McpToolInfo {
  name: string;
  description?: string;
}

/**
 * Sanitized connector shape returned by the /api/mcp routes. NEVER includes
 * OAuth tokens, client secrets, or PKCE material — those stay server-side on
 * the McpServer row.
 */
export interface McpConnector {
  id: string;
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
  trusted: boolean;
  authStatus: McpAuthStatus;
  /** Tools discovered on the server (empty until connected). */
  tools: McpToolInfo[];
  /** Human-readable last error, when authStatus is "error". */
  lastError?: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Request body for POST /api/mcp. */
export interface CreateMcpConnectorRequest {
  name: string;
  url: string;
  description?: string;
  /** Must be true — the user acknowledges they trust this connector. */
  trusted: boolean;
}

/** Request body for PATCH /api/mcp/[id]. All fields optional. */
export interface UpdateMcpConnectorRequest {
  name?: string;
  description?: string;
  enabled?: boolean;
  trusted?: boolean;
}

/**
 * Response from POST /api/mcp and POST /api/mcp/[id]/connect. When
 * `authorizationUrl` is present the client must open it (popup) to complete the
 * OAuth sign-in; the connector flips to "connected" via the OAuth callback.
 */
export interface McpConnectResponse {
  connector: McpConnector;
  authorizationUrl?: string;
}

// ---------------------------------------------------------------------------
// Component prop contracts
// ---------------------------------------------------------------------------

/**
 * Props for the FileUpload component owned by the Files agent and consumed by
 * the Chat-UI composer. Import from "@/components/upload/FileUpload".
 */
export interface FileUploadProps {
  /** Called with the freshly uploaded attachments after a successful upload. */
  onUploaded: (attachments: Attachment[]) => void;
  /** When true the upload control is disabled (e.g. while streaming). */
  disabled?: boolean;
}

/** Props for the message composer (input bar) owned by the Chat-UI agent. */
export interface ComposerProps {
  /** Invoked when the user submits a message. */
  onSend: (message: string, attachments: Attachment[]) => void;
  /** True while a response is streaming; disables send and shows stop affordance. */
  isStreaming: boolean;
  /** Stop the current stream. */
  onStop: () => void;
  /** Disable the entire composer (e.g. unauthenticated). */
  disabled?: boolean;
  /** Placeholder text for the textarea. */
  placeholder?: string;
}

/** Props for an individual rendered chat message. */
export interface MessageItemProps {
  message: ChatMessage;
  /** True while this assistant message is actively streaming. */
  isStreaming?: boolean;
}
