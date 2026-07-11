/**
 * Shared, side-effect-free serializer for the ConversationSummary wire DTO. Used
 * by the conversation list/create/patch routes AND the project-detail route so
 * every place that emits a summary agrees on the exact shape (including the
 * `projectId` field added by the Projects feature).
 */
import type { ConversationSummary } from "@/lib/types";

/** The minimal Conversation row fields needed to build a ConversationSummary. */
export interface ConversationSummaryRow {
  id: string;
  title: string;
  model: string;
  projectId: string | null;
  updatedAt: Date;
}

/** Serialize a Conversation row (or a trimmed `select`) to its API summary. */
export function toConversationSummary(
  c: ConversationSummaryRow,
): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    projectId: c.projectId,
    updatedAt: c.updatedAt.toISOString(),
  };
}
