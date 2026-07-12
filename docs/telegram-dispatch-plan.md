# Telegram Remote-Control Dispatch — Implementation Plan

> A phased plan to add a Telegram bot that lets the owner drive this agent app from their phone. Verified against the current codebase (`src/lib/agent.ts`, `src/lib/schedule/runner.ts`, `src/app/api/cron/route.ts`, `src/lib/schedule/ticker.ts`, `src/instrumentation.ts`, `prisma/schema.prisma`, `package.json`). Every path, signature, env name, and repo workflow below is real. A short **§13 Review findings addressed** appendix at the end records what changed from the first draft and why.

---

## 1. Summary & goal

Add a **third trigger** for the app's headless agent, alongside the two that already exist:

| Trigger | Entry point | Auth | Runtime assumption |
|---|---|---|---|
| In-process ticker (60s) | `src/lib/schedule/ticker.ts` → `runDueSchedules({wait:false})` | `SCHEDULER_ENABLED=1` | long-lived Node |
| External cron | `POST/GET /api/cron` → `runDueSchedules({wait:true})` | `CRON_SECRET` (constant-time) | serverless-safe |
| **Telegram webhook (new)** | `POST /api/telegram/webhook` → `executeTelegramDispatch(...)` | `TELEGRAM_WEBHOOK_SECRET` header + sender allowlist | long-lived Node (fire-and-forget) |

The Telegram trigger reuses the exact machinery scheduled tasks use: an inbound Telegram message is dispatched through **`runChatCompletion()`** (`src/lib/agent.ts`) into a **real `Conversation` owned by the mapped app `User`**, following the same template as **`executeScheduleRun()`** (`src/lib/schedule/runner.ts`) — create a run-log row, create a Conversation, persist the seed user Message, run the agent, persist the assistant Message (with `toolCalls`/`reasoning` JSON columns), bump `conversation.updatedAt`, finalize status — then the reply is delivered back into the Telegram chat via `sendMessage`. Remote-driven chats become first-class citizens in the web UI (they show up in the owner's sidebar exactly like schedule-run chats). The feature is **opt-in and no-ops/503s when unconfigured**, matching the `SCHEDULER_ENABLED`/`CRON_SECRET` convention already in the repo.

Because this transport removes the web UI's live `tool_call` review — the human's chance to see and stop a destructive action mid-run — it adds three controls the web UI doesn't need and the scheduler doesn't have: a **constrained tool policy** (§8, default excludes MCP connectors and `run_javascript`), a **per-chat concurrency lock + per-owner rate ceiling** (§8), and a **stuck-run reconciler** (§3/§8). These are treated as ship-blocking for the tool-enabled surface, not optional hardening.

---

## 2. Architecture

### Request flow

```
┌──────────┐   /newbot     ┌──────────────┐
│ @BotFather│──────────────▶│  Your bot     │  (token: 123456:ABC…)
└──────────┘  (one-time)    └──────────────┘
                                   │
         setWebhook(url, secret_token, allowed_updates:["message"])   ← one-time registration (HTTPS only)
                                   │
   owner's phone ──text──▶ Telegram servers ──HTTPS POST──▶ POST /api/telegram/webhook
                                                                 │
   ┌─────────────────────────────────────────────────────────────┘
   ▼
 [0] runtime="nodejs"; readiness 503 if TOKEN/SECRET/ALLOWLIST/OWNER_EMAIL not all set   (opt-in, fail-closed & observable)
 [1] assert TLS  (x-forwarded-proto === "https")  → 403 on plain http                    (protects the secret header in transit)
 [2] verify  X-Telegram-Bot-Api-Secret-Token  (node:crypto timingSafeEqual)  → 401 on mismatch
 [3] body-size cap (content-length) + try/catch req.json()  → 200-drop on oversized/malformed (no Telegram retry loop)
 [4] shape gate: require message.text; require chat.type==="private" && from.is_bot===false
        ├─ non-text from an ALLOWLISTED sender → reply "I can only handle text right now", 200
        └─ anything else non-conforming → 200 and DROP silently
 [5] AUTHORIZE: message.from.id ∈ TELEGRAM_ALLOWED_USER_IDS ?  → if not, return 200 and DROP silently
 [6] leading "/" command (P0 minimal): /start, /help → reply usage string, 200, DO NOT dispatch
 [7] resolve owner User.id (retry on miss — never negative-cache)  → if unresolved, log + 200 DROP
 [8] RATE CEILING: owner's dispatches in the last hour < cap ?  → else reply "rate limited, try later", 200
 [9] CONCURRENCY LOCK: no running dispatch for this chat ?      → else reply "still working on your last message", 200
 [10] DEDUPE: insert update_id (unique) → on conflict return 200 (Telegram redelivered)
 [11] ─── return 200 { ok:true } IMMEDIATELY (fast ACK) ───
        │  (also: opportunistic throttled reconcile sweep of stale "running" rows)
        └── fire-and-forget (void … .catch(log)) ──▶ executeTelegramDispatch(...)
                                                          │  (mirrors executeScheduleRun)
                                                          ├─ (already reserved TelegramDispatch log, status=running)
                                                          ├─ create Conversation (userId=owner, scheduleId=null)
                                                          ├─ persist seed user Message
                                                          ├─ runChatCompletion({…, userId, toolPolicy})  ← never throws; constrained tools
                                                          ├─ persist assistant Message (encodeJsonArray(toolCalls)/reasoning)
                                                          ├─ bump conversation.updatedAt
                                                          ├─ finalize TelegramDispatch status (success|error)
                                                          └─ sendMessage(chatId, reply)  ← partial content + error note; chunked ≤4096
```

### Why fast-ACK-then-background

Telegram **retries webhook delivery on any non-2XX response** and gives up after "a reasonable number of attempts" ([setWebhook docs](https://core.telegram.org/bots/api#setwebhook)). A `runChatCompletion` turn can take tens of seconds to minutes (same as a `ScheduleRun`). If the handler `await`s the full run before responding, Telegram may time out and **re-POST the same `update_id`**, causing a duplicate agent run and duplicate spend. So the handler must return `200` within a few seconds and do the real work out-of-band. **The eventual reply is a *separate* outbound `sendMessage` call** — Telegram does not forward the webhook's HTTP response body to the chat.

### Long-lived-Node assumption (and serverless degradation)

This app already commits to a persistent Node host: `package.json` `"start": "next start"`, and the `SCHEDULER_ENABLED` ticker (`src/instrumentation.ts` → `setInterval`) is architecturally impossible on per-request serverless. On that host, the ticker's own **`void executeScheduleRun(...).catch(...)` fire-and-forget** pattern (runner.ts `wait:false` branch) runs to completion because the process never terminates between requests — we use the identical pattern here.

- **On the intended long-lived host:** fire-and-forget after the 200 ACK is correct and safe.
- **On pure serverless (Vercel Node functions, etc.):** an unawaited promise is **killed the instant the response returns**. There the options are (a) a durable queue, or (b) `unstable_after` from `next/server`. **Note the pinned version:** this repo is `next ^14.2.18`, where the stable `after` export does **not** exist — it is `unstable_after` and requires `experimental.after: true` in `next.config.js`. Stable `after(...)` from `next/server` only lands in Next 15. Either way the run is bounded by the function's `maxDuration` (needs Pro/Enterprise for >300s), which is often shorter than a real agent turn — so serverless remains a re-architecture, not a drop-in. This plan targets the long-lived host and documents the caveat in `.env.example`/README, exactly as the scheduler already does for `SCHEDULER_ENABLED`.

### Crash recovery (parallel to `reconcileStuckRuns`)

`executeScheduleRun` is paired with `reconcileStuckRuns()` (booted from the ticker) precisely because a crash/restart mid-run leaves a `ScheduleRun` stuck in `"running"` forever. The Telegram dispatch has the **identical** failure mode after the fast ACK, so it gets an equivalent sweep — see **§3 → Crash-recovery reconciler**. This also pins down the **retry semantics**, which the fast-ACK + reserve-before-work design otherwise leaves ambiguous (see that section).

---

## 3. Data model

### Identity mapping — decision: **env allowlist + owner-email**, not a `TelegramLink` table

This is single-owner remote control, so a per-user DB link table with a pairing flow is over-engineering. Use two env-driven facts:

1. **`TELEGRAM_ALLOWED_USER_IDS`** — comma-separated Telegram **user** ids (`message.from.id`) permitted to drive the app. This is the *authorization* check. (In a private chat, `chat.id === from.id`; we gate on `from.id` **and** additionally require `chat.type === "private"` so group membership can never inject commands — the single most load-bearing control in this design, enforced from **P0**, see §10.)
2. **`TELEGRAM_OWNER_EMAIL`** — the app `User.email` every dispatch runs **as**, resolved (and memoized **only on success**) via `prisma.user.findUnique({ where: { email } })` to a `User.id`. That id is passed as `userId` to `runChatCompletion`, so remote runs get the owner's connectors (subject to the tool policy, §8) and their chats land in the owner's sidebar.

Zero per-message identity lookup once resolved, zero migration for identity, clean no-op when unset. *Upgrade path (deferred):* a `TelegramLink { telegramUserId @unique → userId }` table with a `/start <code>` deep-link pairing flow, only if multiple distinct Telegram users must map to different app accounts.

> **Do not negative-cache the owner lookup.** Memoize only a **found** `User.id`; on miss (owner account created after boot, or `TELEGRAM_OWNER_EMAIL` corrected/typo'd, or a transient DB hiccup) leave the cache empty so the next message re-resolves. Caching `null` would make the feature permanently dead until a restart.

### Dispatch log — decision: **reuse `Conversation` + `Message` for content; add a `TelegramDispatch` table (from P0) for the trigger log, idempotency, concurrency, and rate accounting**

- **Reuse `Conversation` + `Message` as-is** for the actual chat content (no schema change to them). A dispatch creates a real `Conversation` with `scheduleId=null`, plus user/assistant `Message` rows persisted with `encodeJsonArray(toolCalls)`/`reasoning`/`reasoningMs` exactly like `executeScheduleRun`. This makes remote chats first-class in the web UI.
- **Do NOT reuse `ScheduleRun`** — its `scheduleId` FK is required and cascades from a `Schedule` row that does not exist for a Telegram trigger; overloading it would force a synthetic schedule.
- **Add `TelegramDispatch`, and add it in P0** (see the resolved store-inconsistency in §10). It is the durable substrate for four things at once: (a) idempotent dedupe of Telegram's at-least-once retries via `updateId @unique` (create-and-catch-unique = a CAS-style anti-double-fire, the same idea as `Schedule.nextRunAt`); (b) the **per-chat concurrency lock** (count `status="running"` rows for a `chatId`); (c) the **per-owner rate ceiling** (count rows for a `userId` in a rolling window); and (d) a `status`/`error`/`conversationId`/`replyMessageId` run log mirroring `ScheduleRun` so a future UI can render remote runs identically. A `globalThis Set<number>` was considered for a "no-migration P0" but **rejected**: it is unbounded (never evicted), lost on restart (post-restart redelivery re-runs and re-spends), and — decisively — cannot back the concurrency lock, rate ceiling, or reconciler that the tool-enabled surface requires. Shipping it would mean writing code we immediately replace.

### Exact Prisma additions

```prisma
// One inbound Telegram-triggered dispatch. Parallel to ScheduleRun (do NOT
// overload ScheduleRun — its scheduleId FK is required). updateId @unique is the
// idempotency key: Telegram's webhook delivery is at-least-once, and every
// dispatch spends real LLM tokens, so a create-and-catch-unique dedupes retries
// BEFORE any expensive work. This row also backs the per-chat concurrency lock
// (running rows for a chatId) and the per-owner rate ceiling (rows per window).
// Chat content lives in the linked Conversation/Message.
model TelegramDispatch {
  id               String    @id @default(cuid())
  userId           String    // app User this ran as (resolved from TELEGRAM_OWNER_EMAIL)
  chatId           String    // Telegram chat.id (String; ids can exceed 32-bit)
  telegramUserId   String?   // Telegram from.id of the sender (String, same reason)
  updateId         Int       @unique   // Telegram update_id — dedupe token (see note below)
  inboundMessageId Int?      // Telegram message_id we replied to
  prompt           String    // the inbound text sent as the seed user message
  conversationId   String?   // Conversation created/continued for this dispatch
  replyMessageId   Int?      // message_id of our first sent reply chunk
  status           String    @default("running") // running | success | error
  trigger          String    @default("telegram")
  error            String?
  startedAt        DateTime  @default(now())
  finishedAt       DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([chatId, status])   // supports the concurrency lock lookup
  @@index([userId, startedAt]) // supports the rolling-window rate count
}
```

Add the inverse relation on `User` (Prisma requires it; purely additive):

```prisma
model User {
  // …existing fields…
  telegramDispatches TelegramDispatch[]
}
```

**Why `updateId` stays `Int` while `chatId`/`telegramUserId` are `String`:** Telegram `chat.id`/`from.id` can exceed 32 bits ("up to 52 significant bits") and lose precision as JS numbers, so they are stored as strings and compared string-vs-string. `update_id` is a bounded, monotonically increasing per-bot counter that stays comfortably within JS safe-integer range; Prisma `Int` on SQLite is stored as a 64-bit `INTEGER`, so there is no overflow risk on the dedupe key. (If you'd rather have one rule for all Telegram ids, storing `updateId` as `String` also works with the same `@unique` semantics — but it's not required.)

**Optional (nice-to-have, defer):** `source String @default("chat")` on `Conversation`, set to `"telegram"` for dispatch chats, to filter remote-originated chats in the UI. Not required — `scheduleId` already stays null, distinguishing them from schedule chats.

### DB workflow — use the repo's `db:push`, **never** `prisma migrate dev`

> ⚠️ **This repo is managed with `prisma db push`, not migrations.** There is **no `prisma/migrations` directory**; `package.json` exposes `db:push`, the README documents `npm run db:push`, and that is exactly how `ScheduleRun`/`Artifact` were added. Running `prisma migrate dev` against a db-push-managed database with no migration-history baseline makes Prisma detect drift and prompt to **RESET/baseline** the database — dropping data on the 161 MB `dev.db` that also carries orphan tables from prior experiments. That is *more* dangerous than the `--accept-data-loss` the first draft warned against.

Apply the additive `TelegramDispatch` table + `User` back-relation with the repo-native command:

```bash
npm run db:push        # plain `prisma db push` — NO --accept-data-loss, ever
```

**Handle the drift warning interactively.** Because `dev.db` has orphan tables that are *not* in `schema.prisma`, even a plain, additive `db push` may surface a **destructive-drift warning about dropping those orphans**. When it does: run it interactively, read the diff, confirm the plan is **only** *creating* `TelegramDispatch` (and the `User` back-relation index) and is **not** dropping anything, and decline if it proposes drops. **Never pass `--accept-data-loss`.** Do **not** introduce `prisma migrate dev` on this repo.

### Crash-recovery reconciler (retry semantics made explicit)

After the fast ACK the run is a detached `void executeTelegramDispatch()`. A deploy/restart mid-run orphans the row in `status="running"` with no `finishedAt`. Mirror `reconcileStuckRuns`:

- **`reconcileStuckDispatches()`** (in `src/lib/telegram/dispatch.ts`): find `TelegramDispatch` rows with `status="running"` and `startedAt` older than ~30 min, set them to `status="error", error="Interrupted by restart"`, `finishedAt=now()`. Best-effort, for each swept row, `sendMessage(chatId, "⚠️ A previous request was interrupted by a restart — please resend.")` so the loss is visible.
- **Where it runs:** primarily from `src/instrumentation.ts` at boot, **behind the same env gate** as the feature (only when `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` are set), alongside the existing `reconcileStuckRuns` boot call. Because there is **no Telegram ticker**, also invoke it **opportunistically at the top of the webhook handler**, throttled to at most once per ~5 min via a `globalThis` timestamp guard — so a restart that never re-hits `instrumentation` still recovers.
- **Retry semantics — decide and document: at-most-once *after reserve*.** `update_id` is reserved (unique insert) *before* the work, so if the process crashes mid-run, Telegram's redelivery of that same `update_id` hits the unique conflict and is dropped — that one message is **lost**, by design, rather than silently re-run and re-spent. The reconciler's job is to (1) free the row from a permanent `"running"` state (so the concurrency lock and any future run-history are honest) and (2) notify the chat to resend. We deliberately do **not** auto-resume interrupted runs (re-executing a half-completed, possibly connector-touching turn is riskier than asking the owner to resend).

---

## 4. Env & config

All new vars are **opt-in**. The webhook route returns **503** until the feature is *fully* configured — see the fail-closed-and-observable gate below.

| Var | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token (`123456:ABC-DEF…`). Gates the feature and is used for all outbound Bot API calls. Server-only — never `NEXT_PUBLIC_*`, **never logged, never interpolated into a log line or error** (a leaked token lets an attacker call `setWebhook` and hijack all traffic). |
| `TELEGRAM_WEBHOOK_SECRET` | Self-generated (`openssl rand -hex 32`), passed as `secret_token` to `setWebhook`; Telegram echoes it in the `X-Telegram-Bot-Api-Secret-Token` header on every POST. Verified with `timingSafeEqual`. This is the transport auth. Rotating it requires re-running `setWebhook` (see §9 → Secret rotation). |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram **user** ids (`from.id`) permitted to dispatch. The application-level authorization and — with connectors in scope — the real crown jewel (§8). Any other sender is dropped (still 200). |
| `TELEGRAM_OWNER_EMAIL` | App `User.email` every dispatch runs **as**; resolved once (positive-only memoization) to `User.id`. Determines Conversation ownership + which connectors the remote agent *could* reach. |
| `TELEGRAM_TOOL_POLICY` | `safe` (default) or `full`. `safe` excludes `run_javascript` and MCP connectors from Telegram-triggered runs (read-only web tools only). `full` grants the owner's entire connector blast radius — see §8 before enabling. |
| `TELEGRAM_MAX_RUNS_PER_HOUR` | Per-owner rolling-window rate ceiling (default `30`). Over the cap → the message is dropped with a "rate limited, try later" reply. |
| `TELEGRAM_MAX_CONCURRENT_PER_CHAT` | Max simultaneously-`running` dispatches per chat (default `1` = serialize). Over the cap → "still working on your last message" reply. |

### Fail-closed **and observable** readiness gate

The transport gate (503) checks `TELEGRAM_BOT_TOKEN` **and** `TELEGRAM_WEBHOOK_SECRET`. But if only those two are set while `TELEGRAM_ALLOWED_USER_IDS` or `TELEGRAM_OWNER_EMAIL` is empty, the endpoint is live, passes 503, 200-ACKs real traffic, and **silently drops every message** — a live-looking endpoint with zero signal that authorization is unconfigured. To avoid that silent half-configured state:

- **Readiness = all four** (`TOKEN` + `SECRET` + non-empty `ALLOWED_USER_IDS` + non-empty `OWNER_EMAIL`). The route 503s unless all four are present, so a deploy is either *fully authorized-and-usable* or *explicitly off* — never live-but-silently-dropping.
- **Loud boot log** in `instrumentation.ts`: if `TOKEN`+`SECRET` are set but the allowlist or owner-email is missing, log a prominent `[telegram] half-configured: …` warning at startup.
- Keep the empty-allowlist **fail-closed** behavior (`allow.size > 0 && …`) regardless; the readiness gate just makes that state observable rather than silent.

### Exact `.env.example` block to append

```bash
# Telegram remote-control dispatch (drive the agent from your phone)
# A THIRD trigger alongside the ticker and /api/cron: an inbound Telegram
# message dispatches a task through runChatCompletion into a real Conversation
# owned by the mapped user, and the reply is sent back into the chat.
#
# OPT-IN & FAIL-CLOSED: the webhook route 503s unless ALL FOUR of TOKEN, SECRET,
# ALLOWED_USER_IDS, and OWNER_EMAIL are set (so a half-configured deploy is off,
# not silently dropping). MUST be served over HTTPS/TLS (Telegram requires it,
# and TLS is what protects the secret_token header in transit).
#
# Assumes the same long-lived Node host as SCHEDULER_ENABLED (the dispatch runs
# fire-and-forget after a fast 200 ACK). On pure serverless it needs a durable
# queue or unstable_after (+ experimental.after on Next 14.2.x) instead.
#
# TELEGRAM_BOT_TOKEN: from @BotFather (/newbot). Server-only secret; never logged.
TELEGRAM_BOT_TOKEN=
# TELEGRAM_WEBHOOK_SECRET: self-generated, passed to setWebhook as secret_token
# and echoed back in the X-Telegram-Bot-Api-Secret-Token header. Generate with:
#   openssl rand -hex 32
# Rotating it? Re-run setWebhook with the new value or in-flight retries 401.
TELEGRAM_WEBHOOK_SECRET=
# TELEGRAM_ALLOWED_USER_IDS: comma-separated Telegram user ids (message.from.id)
# allowed to remote-control the app. Find yours by messaging @userinfobot.
# Anyone not on this list is silently ignored. THIS is the barrier between one
# message and the owner's account — keep it correct.
TELEGRAM_ALLOWED_USER_IDS=
# TELEGRAM_OWNER_EMAIL: the app account (User.email) every dispatch runs as.
TELEGRAM_OWNER_EMAIL=
# TELEGRAM_TOOL_POLICY: safe (default) | full.
#   safe = read-only web tools only; NO run_javascript, NO MCP connectors.
#   full = the agent may call your connected accounts (mail/drive/github/…) and
#          run_javascript UNATTENDED, with no per-tool review. See README security.
TELEGRAM_TOOL_POLICY=safe
# Abuse ceilings (a remote surface that autonomously spends tokens):
TELEGRAM_MAX_RUNS_PER_HOUR=30
TELEGRAM_MAX_CONCURRENT_PER_CHAT=1
```

---

## 5. New files

| Path | Responsibility |
|---|---|
| `src/app/api/telegram/webhook/route.ts` | `POST` handler, `export const runtime = "nodejs"`. Readiness 503 (all four vars); TLS assert; verify `X-Telegram-Bot-Api-Secret-Token` (constant-time); body-size cap + guarded `req.json()`; shape gate (`text` + `chat.type==="private"` + `!from.is_bot`, with a one-time "text only" reply for allowlisted non-text senders); authorize `from.id`; P0 slash-command short-circuit; resolve owner (no negative cache); **rate-ceiling + per-chat concurrency checks**; dedupe `update_id`; fast-ACK 200; opportunistic reconcile sweep; fire-and-forget `executeTelegramDispatch`. |
| `src/lib/telegram/config.ts` | Central env reader / opt-in gate: `getBotToken()`, `getWebhookSecret()`, `isFullyConfigured()`, `parseAllowedUserIds() → Set<string>`, `isAllowedSender(fromId)`, `resolveOwnerUserId()` (positive-only memoization), `getToolPolicy()`, `getRateLimits()`. Keeps the no-op-when-unconfigured logic in one place. |
| `src/lib/telegram/client.ts` | Thin Bot API wrapper over `fetch(https://api.telegram.org/bot<token>/<method>)`: `sendMessage` (surrogate-safe 4096-char chunking on newline boundaries, `parse_mode` omitted = plain text, optional `reply_parameters`), `sendChatAction("typing")`, `editMessageText` (P2), `setWebhook`/`deleteWebhook`/`getWebhookInfo`/`setMyCommands` helpers. **Every call is `try/catch`-wrapped; on failure it logs only `method + status` (never the token-bearing URL) and returns `null`** — delivery errors are logged, not thrown, and can never crash a run. |
| `src/lib/telegram/dispatch.ts` | `executeTelegramDispatch(...)` — the `executeScheduleRun` analog (passes the constrained `toolPolicy`). Also holds `reconcileStuckDispatches()`, the rate/concurrency guard helpers, and the private `encodeJsonArray` helper (copied from runner.ts — see the DRY note in §7). |
| `src/lib/telegram/types.ts` | Minimal structural types for the `Update`/`Message`/`Chat`/`User` fields actually read. (Alternatively add `@grammyjs/types` as a devDependency — see §7.) |
| `src/app/api/telegram/register/route.ts` *(optional)* | One-shot `POST` (`runtime="nodejs"`) that calls `setWebhook`(url + `secret_token` + `allowed_updates:["message"]`) and `setMyCommands`, plus a `DELETE`/`?disable=1` path that calls `deleteWebhook` (see §9). **Auth scoped to the owner (`TELEGRAM_OWNER_EMAIL`'s user) OR `CRON_SECRET` bearer — NOT any authenticated session** (any logged-in non-owner could otherwise re-point or probe the bridge). A curl one-liner is the alternative. |
| `.env.example` | Append the block from §4. |
| `README.md` | New "Telegram remote control" section: BotFather setup, env vars, **HTTPS/TLS requirement**, `setWebhook` registration, **`deleteWebhook` teardown / secret rotation**, `getWebhookInfo.last_error_message` diagnosis, the `safe`/`full` tool-policy security note, ngrok/cloudflared for local dev, the long-lived-host assumption + serverless caveat. |

---

## 6. Key code sketches

Real TypeScript in the app's style (`runtime="nodejs"`, `satisfies ApiError`, default-exported `prisma`, small explicit code).

### `src/lib/telegram/config.ts`

```ts
/**
 * Central config/gate for the Telegram bridge. Every getter returns null/empty
 * when unconfigured so the whole feature no-ops (the webhook route 503s).
 * SERVER-ONLY.
 */
import prisma from "@/lib/db";

export function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}
export function getWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET || null;
}

/** Comma-separated allowlist of Telegram user ids (message.from.id). */
function parseAllowedUserIds(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean),
  );
}

/** Fail-closed AND observable: true only when fully configured. */
export function isFullyConfigured(): boolean {
  return Boolean(
    getBotToken() &&
    getWebhookSecret() &&
    parseAllowedUserIds().size > 0 &&
    (process.env.TELEGRAM_OWNER_EMAIL || "").trim(),
  );
}

/** Authorize the SENDER (from.id), never the room (chat.id). */
export function isAllowedSender(fromId: number | string | undefined): boolean {
  if (fromId === undefined) return false;
  const allow = parseAllowedUserIds();
  return allow.size > 0 && allow.has(String(fromId));
}

export function getToolPolicy(): "safe" | "full" {
  return process.env.TELEGRAM_TOOL_POLICY === "full" ? "full" : "safe";
}
export function getRateLimits() {
  return {
    maxRunsPerHour: Number(process.env.TELEGRAM_MAX_RUNS_PER_HOUR ?? 30),
    maxConcurrentPerChat: Number(process.env.TELEGRAM_MAX_CONCURRENT_PER_CHAT ?? 1),
  };
}

// Memoize the owner User.id ONLY on success. Never negative-cache: if the owner
// account is created after boot or the email is corrected, the next message
// re-resolves instead of staying permanently dead until a restart.
let cachedOwnerId: string | null = null;
export async function resolveOwnerUserId(): Promise<string | null> {
  if (cachedOwnerId) return cachedOwnerId;
  const email = process.env.TELEGRAM_OWNER_EMAIL;
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  cachedOwnerId = user?.id ?? null; // stays null on miss → retried next time
  return cachedOwnerId;
}
```

### `src/lib/telegram/client.ts`

```ts
/**
 * Minimal Telegram Bot API client over raw fetch. No SDK dependency.
 * All methods POST JSON to https://api.telegram.org/bot<token>/<method>.
 * Never throws; the token is NEVER put in a log line. SERVER-ONLY.
 */
import { getBotToken } from "@/lib/telegram/config";

const MAX_TELEGRAM_LEN = 4096;
const SAFE_CHUNK_LEN = 4000;      // under the hard cap
const INTER_CHUNK_DELAY_MS = 1100; // ~1 msg/sec per chat

async function callBotApi(method: string, body: Record<string, unknown>): Promise<any> {
  const token = getBotToken();
  if (!token) return null; // unconfigured → no-op
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Log ONLY method + status. Never the URL (it carries the token). 429
      // carries parameters.retry_after; for a single-owner bot, log and move on.
      console.error(`[telegram] ${method} failed: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    // DNS/network reject: log method + error NAME only, never the token-bearing URL.
    console.error(`[telegram] ${method} threw: ${(err as Error)?.name ?? "error"}`);
    return null; // honor the "delivery errors are logged, not thrown" contract
  }
}

/**
 * Split on the last newline before the limit; back off a hard cut so it never
 * slices a UTF-16 surrogate pair (which would render a broken glyph). Prefer a
 * whitespace boundary when there is no newline.
 */
export function chunkForTelegram(text: string, maxLen = SAFE_CHUNK_LEN): string[] {
  const chunks: string[] = [];
  let rest = text.length ? text : "(empty reply)";
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = rest.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen;
    // Don't split a surrogate pair: if the boundary sits between a high and low
    // surrogate, step back one code unit.
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

export async function sendChatAction(chatId: string, action: "typing" = "typing"): Promise<void> {
  await callBotApi("sendChatAction", { chat_id: chatId, action });
}

/**
 * Send a (possibly long) reply, chunked ≤4096 with ~1s spacing. parse_mode is
 * omitted ON PURPOSE (see §9): the agent emits GitHub-flavored Markdown, which
 * is NOT Telegram MarkdownV2 and would 400 on entity parsing — and, load-bearing
 * for security, plain text also NEUTRALIZES entity/markup injection from any
 * untrusted content the reply may echo. Returns the first chunk's message_id.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<number | undefined> {
  let firstId: number | undefined;
  const chunks = chunkForTelegram(text);
  for (let i = 0; i < chunks.length; i++) {
    const res = await callBotApi("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      ...(i === 0 && replyToMessageId
        ? { reply_parameters: { message_id: replyToMessageId } }
        : {}),
    });
    if (i === 0) firstId = res?.result?.message_id;
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
  }
  return firstId;
}
```

### `src/app/api/telegram/webhook/route.ts`

```ts
import { timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import {
  getWebhookSecret, isFullyConfigured, isAllowedSender,
  resolveOwnerUserId, getRateLimits,
} from "@/lib/telegram/config";
import { sendMessage } from "@/lib/telegram/client";
import { executeTelegramDispatch, maybeReconcileStuckDispatches } from "@/lib/telegram/dispatch";
import type { TelegramUpdate } from "@/lib/telegram/types";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_000_000;

/** Constant-time secret comparison — identical shape to /api/cron's secretsMatch. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const HELP =
  "I dispatch your message to the agent and send back the reply.\n" +
  "Just send plain text. (Commands land in a later phase.)";

export async function POST(req: Request): Promise<Response> {
  // [0] readiness: 503 unless FULLY configured (fail-closed & observable).
  if (!isFullyConfigured()) {
    return Response.json({ error: "Telegram bridge is not configured" } satisfies ApiError, { status: 503 });
  }
  const secret = getWebhookSecret()!;

  // [1] TLS assertion — the secret header is only protected in transit by TLS.
  if ((req.headers.get("x-forwarded-proto") ?? "https") !== "https") {
    return Response.json({ error: "TLS required" } satisfies ApiError, { status: 403 });
  }

  // [2] transport auth: proves the request came from *our* webhook, not who sent it.
  const presented = req.headers.get("x-telegram-bot-api-secret-token");
  if (!presented || !secretsMatch(presented, secret)) {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }

  // [3] body cap + guarded parse. A malformed/oversized body must NOT 500
  // (that would trigger Telegram retries). Ack-and-drop instead.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return Response.json({ ok: true });
  let update: TelegramUpdate;
  try { update = (await req.json()) as TelegramUpdate; }
  catch { return Response.json({ ok: true }); }

  // opportunistic, throttled crash-recovery sweep (no Telegram ticker exists).
  void maybeReconcileStuckDispatches();

  const msg = update.message;

  // [4] shape gate. Private-chat + human-sender is enforced from P0.
  if (!msg || msg.chat.type !== "private" || msg.from?.is_bot) {
    return Response.json({ ok: true }); // drop silently (don't leak the bot)
  }
  // [5] authorize the SENDER before any content-specific replies.
  if (!isAllowedSender(msg.from?.id)) {
    return Response.json({ ok: true }); // unauthorized → silent drop
  }
  // Non-text from an ALLOWLISTED sender: one clear reply beats silence.
  if (!msg.text) {
    await sendMessage(String(msg.chat.id), "I can only handle text right now.", msg.message_id);
    return Response.json({ ok: true });
  }
  // [6] P0 slash-command short-circuit: Telegram auto-sends /start; /help is the
  // reflexive first message. Don't dispatch these verbatim to the LLM.
  if (msg.text.startsWith("/")) {
    const cmd = msg.text.split(/\s|@/)[0];
    if (cmd === "/start" || cmd === "/help") {
      await sendMessage(String(msg.chat.id), HELP, msg.message_id);
      return Response.json({ ok: true });
    }
    // Unknown command in P0: nudge instead of dispatching "/foo" to the model.
    await sendMessage(String(msg.chat.id), `Unknown command ${cmd}. Send plain text, or /help.`, msg.message_id);
    return Response.json({ ok: true });
  }

  // [7] resolve owner (retries on miss — resolveOwnerUserId never negative-caches).
  const ownerUserId = await resolveOwnerUserId();
  if (!ownerUserId) {
    console.error("[telegram] TELEGRAM_OWNER_EMAIL does not resolve to a User");
    return Response.json({ ok: true });
  }

  const chatId = String(msg.chat.id);
  const { maxRunsPerHour, maxConcurrentPerChat } = getRateLimits();

  // [8] per-owner rolling-window rate ceiling (autonomous spend guard).
  const sinceHour = new Date(Date.now() - 3_600_000);
  const recent = await prisma.telegramDispatch.count({
    where: { userId: ownerUserId, startedAt: { gt: sinceHour } },
  });
  if (recent >= maxRunsPerHour) {
    await sendMessage(chatId, "Rate limit reached — please try again later.", msg.message_id);
    return Response.json({ ok: true });
  }

  // [9] per-chat concurrency lock: serialize by default so fast successive
  // messages can't fan out into N parallel (N-times-the-spend) agent runs.
  const running = await prisma.telegramDispatch.count({
    where: { chatId, status: "running" },
  });
  if (running >= maxConcurrentPerChat) {
    await sendMessage(chatId, "Still working on your previous message — one at a time.", msg.message_id);
    return Response.json({ ok: true });
  }

  // [10] idempotency: reserve update_id (unique insert) BEFORE any expensive
  // work. On conflict this is a redelivery of an update we already handled.
  try {
    await prisma.telegramDispatch.create({
      data: {
        userId: ownerUserId, chatId,
        telegramUserId: String(msg.from?.id ?? ""),
        updateId: update.update_id, inboundMessageId: msg.message_id,
        prompt: msg.text, status: "running",
      },
    });
  } catch {
    return Response.json({ ok: true }); // duplicate delivery — already reserved
  }

  // [11] fast ACK; run out-of-band. Safe on the long-lived Node host (same as
  // the ticker's wait:false). NOTE the small TOCTOU on [9]: two near-simultaneous
  // messages can both pass the count. That merely bounds fan-out (not perfect
  // serialization); for strict serialization, move the [9] count inside a
  // transaction that flips a "queued" row to "running".
  void executeTelegramDispatch({
    updateId: update.update_id, chatId,
    inboundMessageId: msg.message_id, text: msg.text, ownerUserId,
  }).catch((err) => console.error("[telegram] dispatch failed", err));

  return Response.json({ ok: true });
}
```

### `src/lib/telegram/dispatch.ts` (the `executeScheduleRun` analog)

```ts
/**
 * Dispatch one inbound Telegram message end-to-end. Mirrors executeScheduleRun
 * step-for-step (log → Conversation → seed Message → runChatCompletion →
 * assistant Message → bump updatedAt → finalize), then delivers the reply back
 * into the chat with a CONSTRAINED tool policy. Never throws. SERVER-ONLY.
 */
import prisma from "@/lib/db";
import { runChatCompletion } from "@/lib/agent";
import { sendMessage, sendChatAction } from "@/lib/telegram/client";
import { getToolPolicy } from "@/lib/telegram/config";
import { DEFAULT_MODEL, DEFAULT_EFFORT } from "@/lib/types";
import type { ChatMessage } from "@/lib/types";

/** Copied from runner.ts so toolCalls persist identically to /api/chat.
 *  (Consider extracting encodeJsonArray to a shared util to avoid drift.) */
function encodeJsonArray(value: unknown[] | undefined | null): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

interface DispatchInput {
  updateId: number; chatId: string; inboundMessageId: number;
  text: string; ownerUserId: string;
}

export async function executeTelegramDispatch(input: DispatchInput): Promise<void> {
  const { updateId, chatId, inboundMessageId, text, ownerUserId } = input;
  await sendChatAction(chatId, "typing"); // liveness (Telegram clears after ~5s)

  let conversationId: string | null = null;
  try {
    const conversation = await prisma.conversation.create({
      data: { userId: ownerUserId, title: text.slice(0, 60) || "Telegram", model: DEFAULT_MODEL },
    });
    conversationId = conversation.id;
    await prisma.telegramDispatch.update({ where: { updateId }, data: { conversationId } });

    const userMsg = await prisma.message.create({
      data: { conversationId, role: "user", content: text, attachments: null, toolCalls: null },
    });
    const userMessage: ChatMessage = {
      id: userMsg.id, role: "user", content: text, createdAt: userMsg.createdAt.toISOString(),
    };

    // toolPolicy is a NEW optional field on StreamChatParams (see §8). Existing
    // callers omit it and keep full tools; Telegram defaults to "safe".
    const result = await runChatCompletion({
      model: DEFAULT_MODEL,
      history: [],           // P2: load prior Messages of the chat's conversation
      userMessage,
      effort: DEFAULT_EFFORT,
      userId: ownerUserId,
      toolPolicy: getToolPolicy(),
    }); // never throws — failures surface on result.error

    await prisma.message.create({
      data: {
        conversationId, role: "assistant", content: result.content, attachments: null,
        toolCalls: encodeJsonArray(result.toolCalls),
        reasoning: result.reasoning ?? null, reasoningMs: result.reasoningMs ?? null,
      },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    // Don't discard partial content on error: runChatCompletion returns whatever
    // streamed before failing. Send it, then APPEND the error as a trailing note.
    const replyText = result.error
      ? (result.content ? `${result.content}\n\n⚠️ ${result.error}` : `⚠️ ${result.error}`)
      : result.content;
    const replyMessageId = await sendMessage(chatId, replyText, inboundMessageId);

    await prisma.telegramDispatch.update({
      where: { updateId },
      data: {
        status: result.error ? "error" : "success",
        error: result.error ?? null,
        replyMessageId: replyMessageId ?? null,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[telegram] run failed for update", updateId, err);
    const message = err instanceof Error ? err.message : "Telegram dispatch failed";
    try {
      await prisma.telegramDispatch.update({
        where: { updateId }, data: { status: "error", error: message, finishedAt: new Date() },
      });
    } catch (e) { console.error("[telegram] failed to mark dispatch errored", updateId, e); }
    // Best-effort notice; guarded so it can never re-throw and mask the original
    // error (sendMessage itself is already try/catch-internal and returns null).
    await sendMessage(chatId, `⚠️ Dispatch failed: ${message}`, inboundMessageId).catch(() => {});
  }
}

// ── Crash-recovery reconciler (parallel to reconcileStuckRuns) ──────────────
const RECONCILE_THROTTLE_MS = 5 * 60_000;
declare global { var __tgLastReconcile: number | undefined; }

export async function reconcileStuckDispatches(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const stuck = await prisma.telegramDispatch.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
  });
  for (const d of stuck) {
    await prisma.telegramDispatch.update({
      where: { id: d.id },
      data: { status: "error", error: "Interrupted by restart", finishedAt: new Date() },
    });
    // Make the loss visible (at-most-once-after-reserve semantics; §3).
    await sendMessage(d.chatId, "⚠️ A previous request was interrupted by a restart — please resend.")
      .catch(() => {});
  }
}

/** Throttled, fire-and-forget entry used at the top of the webhook handler. */
export async function maybeReconcileStuckDispatches(): Promise<void> {
  const now = Date.now();
  if (globalThis.__tgLastReconcile && now - globalThis.__tgLastReconcile < RECONCILE_THROTTLE_MS) return;
  globalThis.__tgLastReconcile = now;
  await reconcileStuckDispatches().catch((e) => console.error("[telegram] reconcile failed", e));
}
```

### Boot wiring (`src/instrumentation.ts`)

Alongside the existing `reconcileStuckRuns` boot call, and behind the feature gate:

```ts
// inside register(), node runtime only, after the scheduler wiring:
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) {
  const { reconcileStuckDispatches } = await import("@/lib/telegram/dispatch");
  const { isFullyConfigured } = await import("@/lib/telegram/config");
  if (!isFullyConfigured()) console.warn("[telegram] half-configured: token/secret set but allowlist or owner email missing");
  void reconcileStuckDispatches().catch((e) => console.error("[telegram] boot reconcile failed", e));
}
```

### Tool-policy plumbing (`src/lib/agent.ts` — small additive change)

`StreamChatParams` gains an optional `toolPolicy?: "safe" | "full"` (default `"full"`, preserving every existing caller's behavior). Where the agent assembles its tools:

- `"full"` → unchanged: web tools + `run_javascript` + `loadUserMcpServers(userId)` connectors.
- `"safe"` → read-only web tools only; **skip `loadUserMcpServers` entirely** and **exclude `run_javascript`**. This is what Telegram passes by default, so a fire-and-forget remote run cannot touch the owner's mail/drive/github or the escapable JS sandbox without an explicit opt-in.

### `setWebhook` registration (one-time)

Curl:

```bash
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "'"${NEXTAUTH_URL}"'/api/telegram/webhook",
    "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET}"'",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
```

Or the optional `src/app/api/telegram/register/route.ts` (owner- or `CRON_SECRET`-gated) calling the same `setWebhook` params via `src/lib/telegram/client.ts`, plus `setMyCommands` for the command menu (P1).

---

## 7. Library decision

**Recommended: raw `fetch` against `api.telegram.org`, no runtime Telegram dependency.** Optionally add **`@grammyjs/types`** (0 runtime deps, types-only, compiles away) as a devDependency for typed `Update`/`Message` shapes instead of hand-rolling `src/lib/telegram/types.ts`.

Reasoning:
- The functional need is tiny — *verify one header, read one JSON body, call `runChatCompletion`, POST one `sendMessage`* — well within the size of the `/api/cron` handler it mirrors. Middleware chains, command routers, keyboard/session plugins from a framework are dead weight here.
- It matches the app's ethos: currently **zero** Telegram deps, a hand-rolled `CRON_SECRET` check, and the opt-in-and-503-when-unconfigured pattern.
- **Avoid Telegraf** — no npm release since Feb 2024, no commits since ~Jan 2025; its `webhookCallback` is Express/Connect-style and doesn't fit App Router.
- **Avoid `node-telegram-bot-api`'s new API today** — the App-Router-friendly `nextAppWebhook` only exists on `2.0.0-alpha.3` (`@next` tag, "no v1 compatibility"); the `latest` (1.1.2) is the old EventEmitter/own-HTTP-server model. An alpha is an unacceptable stability bar for a remote-control surface.
- **If richer ergonomics are ever needed** (multi-step conversations, inline keyboards, a growing command surface), reach for **grammY** — the only actively-maintained option with a Fetch-standard adapter. **Use `webhookCallback(bot, "std/http", { secretToken })`, NOT the `"next-js"` adapter** (that one targets the Pages Router `NextApiRequest`/`NextApiResponse` and will not work in `app/**/route.ts`).

**DRY note.** `encodeJsonArray` (from `runner.ts`) and the `secretsMatch`/constant-time compare (from `/api/cron`) are both private/non-exported in their origins and are duplicated here. That's acceptable given the app's low-DRY posture, but leave a one-line comment on each copy — or better, extract them to a shared `src/lib/util` — so the copies don't drift.

---

## 8. Security

The front door is modeled directly on `/api/cron` and is solid: constant-time `secret_token` compare, fail-closed readiness, sender allowlist that fails closed on empty, strict `chat.type==="private"` + `!is_bot` gating, reserve-`update_id`-before-work idempotency, and the correct check ordering (secret → parse → authorize → reserve → fast-ACK) so unauthenticated traffic never touches the DB. The real risks are **not at the front door** — they are blast-radius and abuse controls, addressed here as ship-blocking for the tool-enabled surface.

**The load-bearing truth:** with connectors in scope, the `from.id` allowlist — not the transport secret — is the sole barrier between one Telegram message and the owner's connected accounts. Allowlist correctness is the crown jewel.

Threat model + mitigations (all reflected in the sketches above):

- [x] **Two independent auth layers.** (1) `secret_token` header via `timingSafeEqual` proves *"this came from Telegram's infra"*; (2) sender allowlist proves *"this came from my Telegram account."* Both required.
- [x] **Fail closed AND observable.** 503 unless **all four** vars are set (§4) — never a live-but-silently-dropping endpoint. Constant-time header compare (length-check first — `timingSafeEqual` throws on unequal lengths). This is a real, previously-exploited bug class (GHSA-mp5h-m6qj-6292: webhook accepted without verifying the header when the secret was missing).
- [x] **TLS required.** Telegram only delivers over HTTPS, but nothing in the app inherently rejects being served plain-`http` behind a misconfigured TLS-terminating proxy — which would expose the `secret_token` header on the wire. Assert `x-forwarded-proto === "https"` at the route (behind a trusted proxy) and document the HTTPS requirement in README/`.env.example`.
- [x] **Gate on `from.id`, never `chat.id`.** Plus `chat.type==="private"` and `!from.is_bot`, **enforced from P0** (§10). The safest default for a control bot is to reject all non-private chats outright — this is what stops an allowlisted owner's *group* messages (and the owner-privileged reply) from being dispatched into and leaked to a group.
- [x] **Constrained tool policy (default `safe`).** A dispatch runs *as the owner* and — unlike the web UI — has **no live `tool_call` review**, so a single ambiguous or injected instruction ("clean up my inbox") would execute irreversibly with no human in the loop. Default `TELEGRAM_TOOL_POLICY=safe` therefore **excludes MCP connectors and `run_javascript`** from Telegram-triggered runs (read-only web tools only). `full` is an explicit, documented opt-in that grants the owner's entire connector blast radius; a future P2 confirmation flow ("reply CONFIRM to run with full tools") can gate connector categories per-message instead of globally.
- [x] **`run_javascript` is NOT a mitigation — it's an amplified risk.** *(Correction to the first draft, which wrongly claimed it "needs no new hardening.")* `src/lib/tools/run-javascript.ts` is a `new Function`-with-shadowed-globals sandbox that is trivially escapable: `(function(){}).constructor("return process")()` reaches the genuine `Function` constructor in the global realm, exposing `process.env` (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`), which a public `web_fetch` can then exfiltrate. The precondition is prompt injection — exactly the "owner forwards an attacker link, says 'summarize this'" path — and Telegram *widens* that injection surface (casual mobile forwarding, no visible tool-call review). Mitigations, in order: (a) `safe` policy excludes `run_javascript` from this transport entirely (default); (b) if `full` is ever enabled, treat `run_javascript` as untrusted — harden it (isolated-vm / a worker with the module system stripped / freeze `Function`/`constructor` reachability and null the realm) and/or scrub secret env vars from the agent-reachable process **before** exposing it over Telegram.
- [x] **Rate ceiling + per-chat concurrency lock.** A money-spending, tool-driving remote surface must be bounded even behind the allowlist (a fat-fingered owner or a compromised Telegram account can fire N messages fast). `TELEGRAM_MAX_CONCURRENT_PER_CHAT` (default 1) serializes per chat; `TELEGRAM_MAX_RUNS_PER_HOUR` (default 30) caps rolling spend and replies "rate limited, try later" when exceeded. Both are backed by the `TelegramDispatch` table (§3). Keep a coarse body-size cap / reverse-proxy throttle as a pre-auth flooding defense too.
- [x] **Idempotency via `update_id`.** Reserve `update_id` (unique insert) **before** any dispatch; retry semantics are *at-most-once after reserve* (§3), with the reconciler cleaning stuck rows and notifying the chat.
- [x] **Crash recovery.** `reconcileStuckDispatches()` sweeps orphaned `"running"` rows on boot + opportunistically (§3) — the safety net the design's own analog (`reconcileStuckRuns`) has.
- [x] **Store ids as strings.** `chat.id`/`from.id` can exceed 32-bit ("up to 52 significant bits"); columns are `String`, compares are string-vs-string. `update_id` stays `Int` with the justification in §3.
- [x] **Narrow `allowed_updates` to `["message"]`** at `setWebhook` to cut delivery surface (still defensively shape-check — the filter isn't retroactive).
- [x] **Bot token is a control-plane credential.** Anyone holding it can re-point `setWebhook` at their own server. Keep it server-only, **never interpolate the token-bearing API URL into any log line or error** (the `callBotApi` wrapper logs only `method + status`), and keep the register route owner/`CRON_SECRET`-gated (not any session).
- [x] **Guarded parse + no 500-retry-loop.** `req.json()` is `try/catch`'d and returns `200`-drop on malformed/oversized bodies so a bad body never triggers a Telegram retry storm.
- [x] **Plain-text replies are also a security control.** Omitting `parse_mode` (§9) dodges MarkdownV2 400s *and* neutralizes entity/markup injection from any untrusted fetched content the reply echoes.
- [ ] **Residual risk the allowlist does NOT solve:** second-order prompt injection when the owner forwards attacker-controlled content ("summarize this"). This is identical to the web UI and partly mitigated by `web-fetch.ts` wrapping fetched content in `<web_content untrusted="true">` tags and by the SSRF guard in `src/lib/net/safe-fetch.ts` (real, strong, unweakened by the new transport). The `safe` tool policy further limits what a successful injection can *do* (no connectors, no JS). Document this explicitly rather than assuming it away.

---

## 9. Long-running runs & UX

- **Fast-ACK + typing + deliver-on-complete (MVP).** Return 200 immediately; fire `sendChatAction(chat_id, "typing")` at dispatch start; run to completion; then `sendMessage`. `sendChatAction` status lasts ≤5s, so a P2 keep-alive can re-fire it every ~4s while the run is in flight.
- **Message chunking.** `sendMessage` text is capped at **4096 chars after entity parsing** — no server-side auto-split. Chunk on newline boundaries at ~4000 chars (surrogate-pair-safe, §6) and space sends ~1.1s apart to respect **~1 msg/sec per chat** (429 carries `parameters.retry_after`).
- **Plain text, no `parse_mode`.** The agent emits GitHub-flavored Markdown, which is *not* Telegram MarkdownV2 and would 400 on entity parsing (a `.` in a filename or a `-` bullet breaks it). It is also the entity-injection defense noted in §8. If formatting is wanted later, convert Markdown → the narrow **HTML** subset (escape only `< > &`) rather than hand-rolling full MarkdownV2 escaping.
- **Partial content on error.** `runChatCompletion` returns whatever streamed before failing alongside `result.error`; the reply sends that partial content and appends `⚠️ <error>` as a trailing note, rather than discarding the partial answer (§6 `dispatch.ts`).
- **Non-text inbound.** An allowlisted sender who sends a voice note / photo / document gets one clear `"I can only handle text right now."` reply instead of silence (silence is indistinguishable from a broken bot). Unauthorized senders still get silent-drop (don't leak the bot). Inbound attachments are a natural P2/P3 extension: the agent already supports `input_image`/`input_file` via `buildUserContent`, so photos are droppable *value* — it needs `getFile` + hosting so the vision path's `toAbsoluteUrl` resolves (open question #6).
- **Optional streamed progress (P2).** Drain `streamChat()` instead of `runChatCompletion()`; send a "Working…" placeholder, keep its `message_id`, and `editMessageText` it on `tool_call` boundaries. **Throttle edits to ≥1/sec per chat** (or one edit per tool-call boundary — simpler, sidesteps the rate limit). Do not attempt naive per-token `editMessageText`.
- **Command menu** via `setMyCommands` (P1+): `/new`, `/status`, `/tasks` (+ `/run <id>`), `/help`. Parse commands from `message.entities` where `entity.type === "bot_command"` at `offset 0` (`text.slice(0, entity.length)`) so `/run@yourbot` still parses. In **P0**, a minimal leading-`/` short-circuit already handles the auto-sent `/start` and the reflexive `/help` so the owner's first interaction isn't the model answering the literal prompt `"/start"`. **`/cancel`/`/stop`:** `runChatCompletion`/`streamChat` currently expose **no `AbortController`/cancellation hook** — do **not** ship a `/cancel` that silently no-ops. Omit it until abort plumbing is threaded through `src/lib/agent.ts`, or make it explicitly a queue-clear with a clear label.
- **Threading.** P0/P1: **new Conversation per message** (matches `executeScheduleRun` / Claude-Desktop dispatch semantics). P2: map `chatId → active conversationId`, load prior `Message`s as `history`, reset with `/new`.
- **Deregistration / disable & secret rotation** (operational). To turn the feature **off**, don't just unset envs — that leaves the webhook registered, so Telegram keeps POSTing, the route 503s forever, Telegram retries and eventually flags the webhook with a persistent `last_error`. Instead call `deleteWebhook` (or `setWebhook` with an empty `url`), then unset the envs. Surface `getWebhookInfo.last_error_message` (README + optional register-route `GET`) so a mis-registered or disabled webhook is diagnosable. **Rotating `TELEGRAM_WEBHOOK_SECRET`** requires re-running `setWebhook` with the new `secret_token` — in-flight Telegram retries carrying the old secret will 401 until you do.

---

## 10. Phased rollout

Each phase is a small, shippable slice. **The `TelegramDispatch` table lands in P0** (via `npm run db:push`) — it is the substrate for idempotency, the concurrency lock, the rate ceiling, and the reconciler, so there is no coherent "no-migration P0."

**P0 — MVP: one owner, one message → one reply, safely bounded.**
- `webhook/route.ts` + `client.ts` (`sendMessage` + surrogate-safe chunking from the start) + `dispatch.ts` + `config.ts` + `types.ts`; `TelegramDispatch` table via `npm run db:push`.
- **Fail-closed-and-observable readiness 503** (all four vars); TLS assertion; secret-header verify (401); guarded parse + body cap.
- **Private-chat + `!is_bot` gate is a P0 must-have** (it is the "single most load-bearing control" and is ~2 lines — no reason to defer). Sender allowlist (single or multi id).
- Owner resolution (positive-only memoization); **default `safe` tool policy** (no connectors, no `run_javascript`); **per-chat concurrency lock + per-owner rate ceiling**.
- Minimal leading-`/` short-circuit for `/start`/`/help` (don't dispatch them to the LLM); non-text → one "text only" reply for allowlisted senders.
- Durable `update_id` dedupe (the table) + **crash-recovery reconciler** wired into `instrumentation.ts` and opportunistically in the handler.
- Fast-ACK + fire-and-forget dispatch; plain-text reply with partial-content-on-error. Register webhook by curl (HTTPS).
- *Ship criterion:* text the bot → get the agent's reply; the chat appears in the web sidebar; a duplicate `update_id` is a no-op; a group message is dropped; a restart mid-run doesn't leave a permanent `running` row.

**P1 — Command surface + registration ergonomics.**
- `setMyCommands` + full `bot_command` entity parsing; `/help`, `/status`, `/new`.
- Optional `register/route.ts` (owner/`CRON_SECRET`-gated) with `setWebhook` + `deleteWebhook`/disable + `getWebhookInfo` diagnosis.
- Optional per-message `full`-tool confirmation flow ("reply CONFIRM to run with connectors") if `full` is desired without flipping the global env.

**P2 — Conversation continuity + progress.**
- Map `chatId → active Conversation`; load history so follow-ups have context; `/new` resets.
- Streamed progress: `editMessageText` on tool-call boundaries (throttled), placeholder `message_id` on the dispatch row.
- Typing keep-alive every ~4s during long runs (guard any timer on `globalThis` like the ticker).
- Inbound attachments: `getFile` + hosting → map Telegram photos/documents into `Attachment[]`.

**P3 — Remote control of scheduled tasks + artifact links.**
- `/tasks` → `prisma.schedule.findMany({where:{userId}})`; `/run <id>` → `runScheduleNow(id, ownerUserId)` (already ownership-checked, returns null → "not found / not yours").
- Surface artifact deep links (`${NEXTAUTH_URL}/…`) in replies when a dispatch produces artifacts.
- (Only once an `AbortController` is threaded through `agent.ts`) distinct `/stop` (interrupt now) vs `/cancel` (clear queue).

---

## 11. Testing / verification plan

**Local tunnel (Telegram needs public HTTPS on 443/80/88/8443 with a valid cert).**
```bash
npm run dev                       # long-lived Node host
cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
# register the webhook against the tunnel URL:
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://<tunnel-host>/api/telegram/webhook","secret_token":"'"${TELEGRAM_WEBHOOK_SECRET}"'","allowed_updates":["message"],"drop_pending_updates":true}'
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"   # confirm url, pending_update_count, and last_error_message
```
> Do **not** run `getUpdates` while a webhook is set — the API disables long-polling for as long as a webhook exists. For pure unit dev, temporarily `deleteWebhook` and poll `getUpdates` (a separate mode). Confirming teardown: after `deleteWebhook`, `getWebhookInfo` should report an empty `url`.

**Auth / gating (curl the route directly, no Telegram needed):**
```bash
# 503 when NOT fully configured (any of the four vars unset)
curl -i -X POST http://localhost:3000/api/telegram/webhook
# 401 on bad/missing secret header
curl -i -X POST http://localhost:3000/api/telegram/webhook \
  -H 'x-telegram-bot-api-secret-token: wrong' -H 'content-type: application/json' -d '{}'
# 200 + dispatch on a valid Update from an allowlisted from.id
curl -i -X POST http://localhost:3000/api/telegram/webhook \
  -H "x-telegram-bot-api-secret-token: ${TELEGRAM_WEBHOOK_SECRET}" \
  -H 'content-type: application/json' \
  -d '{"update_id":1001,"message":{"message_id":5,"date":1700000000,"chat":{"id":<OWNER_ID>,"type":"private"},"from":{"id":<OWNER_ID>,"is_bot":false,"first_name":"Me"},"text":"what is 2+2?"}}'
```
**Fast-ACK + background delivery:** the curl above returns `{"ok":true}` in well under a second; the answer arrives seconds later as a *separate* `sendMessage`. Confirm a new `Conversation` + user/assistant `Message` rows (`prisma studio`), the chat in the web sidebar, and a `TelegramDispatch` row `running → success`.

**Idempotency:** replay the same `update_id` → 200, **no** second Conversation, no second LLM call. One `TelegramDispatch` row.

**Authorization / shape gates:** `from.id` not in allowlist → 200, no dispatch, no rows. `chat.type:"group"` → dropped. Non-text from an allowlisted sender → one "text only" reply, no dispatch. `/start` → help reply, no LLM run.

**Abuse ceilings:** fire >`TELEGRAM_MAX_RUNS_PER_HOUR` valid updates in an hour → later ones get "rate limited" and create no run. Send a second update while the first is still `running` (with `MAX_CONCURRENT_PER_CHAT=1`) → "still working" reply, no second dispatch.

**Tool policy:** with `TELEGRAM_TOOL_POLICY=safe` (default), a prompt that would call a connector or `run_javascript` returns without invoking them (verify no MCP tool-call rows). Flip to `full` and confirm connectors are reachable.

**Crash-orphan path (the gap the first draft's tests missed):** set a `TelegramDispatch` row to `status="running"` with `startedAt` 40 min ago, then boot / hit the webhook → `reconcileStuckDispatches` flips it to `error: Interrupted by restart` and sends the "please resend" notice.

**Chunking (P0):** a prompt yielding >4096 chars ("write a 6000-word essay") → multiple sequential messages split on newlines, no 400, no broken glyphs at boundaries.

**Error path:** temporarily unset `OPENAI_API_KEY` → `result.error` surfaces; the bot replies with any partial content + `⚠️ …`, and the row is `error`, not a perpetual `running`.

---

## 12. Open questions / decisions for the user

Several first-draft open questions are now **decided by this revision** and no longer need input: per-chat concurrency (**serialize by default**, env-tunable), the `TelegramDispatch` table (**at P0**), the idempotency store (**the table, not an in-memory Set**), the DB workflow (**`npm run db:push`**), and the tool surface (**`safe` policy by default**). What genuinely remains:

1. **Deploy target.** Confirmed long-lived Node (`next start`, like `SCHEDULER_ENABLED`)? Fire-and-forget after the 200 ACK only survives there. Serverless would need a durable queue (or `unstable_after` + `experimental.after` on Next 14.2.x, bounded by `maxDuration`) and, like the ticker, a re-architecture.
2. **Tool policy default.** Ship `safe` (no connectors/JS) as the default (recommended), with `full` an explicit opt-in — or do you want `full` from day one for your single-owner use, accepting the unattended connector blast radius (§8)?
3. **Threading semantics.** New Conversation per message (P0/P1) vs a continuing per-chat thread with history + `/new` (P2)? Recommendation: new-per-message first, continuity in P2.
4. **Command surface.** Free-text dispatch only, or also `/tasks` + `/run <id>` to control scheduled tasks from the phone (P3)? `runScheduleNow` already exists and is ownership-checked, so this is nearly free.
5. **`/cancel` / `/stop`.** OK to omit until an `AbortController` is threaded through `runChatCompletion`/`streamChat`? Shipping a no-op cancel is explicitly not recommended.
6. **Reply formatting.** Plain text (safe, recommended, and injection-neutralizing) forever, or invest in a GFM→HTML-subset converter so code blocks render?
7. **Inbound attachments.** Text-only for now, or map Telegram photos/documents into `Attachment[]` (needs `getFile` + hosting so `toAbsoluteUrl` resolves) at P2/P3?

---

## 13. Review findings addressed

This revision folds the confirmed review findings into the sections above. What changed and why:

- **[HIGH] Wrong migration command → data-loss risk.** Replaced `prisma migrate dev --name telegram_dispatch` (and the `--accept-data-loss` warning framing) with the repo-native **`npm run db:push`** workflow in §3 → *DB workflow*, because this repo has **no `prisma/migrations` dir** and is db-push-managed (that's how `ScheduleRun`/`Artifact` were added); `migrate dev` would trigger a drift **reset**. Added the explicit caveat that `dev.db`'s orphan tables can surface a destructive-drift warning that **must be handled interactively**, confirming the sync only *creates* `TelegramDispatch` and never passing `--accept-data-loss`.
- **[HIGH] Private-chat/`!is_bot` gate deferred to P1 while called "most load-bearing."** Moved `chat.type==="private"` + `!from.is_bot` into the **P0 must-have** gate list (§10) and the §6 route sketch, so the phase table matches the threat model and an allowlisted owner's group messages can never be dispatched or leaked.
- **[MED] No rate/concurrency/spend cap.** Added a **per-chat concurrency lock** (`TELEGRAM_MAX_CONCURRENT_PER_CHAT`, default serialize) and a **per-owner rolling-window rate ceiling** (`TELEGRAM_MAX_RUNS_PER_HOUR`), both backed by the `TelegramDispatch` table, with "still working"/"rate limited" replies — promoted from "open question" to enforced P0 controls (§4, §6, §8).
- **[MED] `run_javascript` wrongly cited as a mitigation.** Corrected §8: it is an **escapable secret-exfil risk that the new transport amplifies**, not a mitigation. Default `safe` tool policy now **excludes `run_javascript`** from Telegram runs; `full` mode documents the required hardening / env-secret scrubbing.
- **[MED] Unattended full-MCP execution, no human review.** Introduced `TELEGRAM_TOOL_POLICY` (default **`safe`** → no MCP connectors, no JS) via a small additive `toolPolicy` param on `runChatCompletion`, plus a documented `full` opt-in and a P2 per-message confirmation path (§4, §6, §8). Documented that the `from.id` allowlist is the sole barrier to the owner's entire connector blast radius.
- **[MED] Secret-leak-via-logs + broken "never throws" in `callBotApi`.** Wrapped the fetch in **try/catch**, returning `null` and logging **only `method + status`** — never the token-bearing URL (§6 `client.ts`). Confirmed the final error-notice `sendMessage` is `.catch(()=>{})`-guarded *and* internally non-throwing.
- **[MED ×3] No stuck-run reconciler / crash recovery / retry semantics.** Added `reconcileStuckDispatches()` (boot via `instrumentation.ts` behind the env gate + throttled opportunistic sweep in the handler), sweeping stale `running` rows to `error: Interrupted by restart` and notifying the chat. Documented **at-most-once-after-reserve** retry semantics explicitly (§3, §6, §8, §11).
- **[MED] `after()` API name wrong for Next 14.2.18.** Corrected §2 to **`unstable_after` + `experimental.after`** for 14.2.x (stable `after` is Next 15), and noted `maxDuration` bounding.
- **[MED] No deregistration / disable story.** Added `deleteWebhook`/empty-`url` teardown, `getWebhookInfo.last_error_message` diagnosis, and secret-rotation-requires-`setWebhook` notes (§5, §9, §11).
- **[MED] Non-text messages silently dropped.** Allowlisted senders now get one **"I can only handle text right now"** reply; unauthorized senders still silent-drop. Inbound attachments flagged as the P2/P3 extension (§6, §9, §10).
- **[MED] P0 sends `/start`/`/help` to the LLM.** Added a P0 leading-`/` short-circuit that answers help and refuses to dispatch commands verbatim (§6, §9, §10).
- **[MED] Idempotency store inconsistent / unbounded.** Resolved by **adopting the `TelegramDispatch` table at P0** (the route sketch already required it, and the concurrency/rate/reconcile features need durable rows); the unbounded, restart-lossy `globalThis Set` is documented as a rejected alternative (§3, §10).
- **[LOW, folded]** Fail-closed **and observable** readiness gate now covers all four vars + a boot warning (§4); guarded `req.json()` + body-size cap → 200-drop instead of 500-retry-loop (§6); `resolveOwnerUserId` **positive-only memoization** (no negative cache) (§3, §6); register route scoped to **owner/`CRON_SECRET`** only (§5); **surrogate-pair-safe** chunking (§6); **partial-content-on-error** reply instead of discarding it (§6, §9); DRY note on the copied `encodeJsonArray`/`secretsMatch` helpers (§7).
- **[Missing pieces, folded]** TLS assertion + HTTPS requirement (§2, §4, §8, §11); `parse_mode`-omitted called out as a **load-bearing** entity-injection defense (§6, §8, §9); `update_id` `Int`-vs-`String` typing justified against SQLite's 64-bit INTEGER (§3).