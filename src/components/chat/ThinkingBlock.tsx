"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { cn } from "@/components/ui/cn";

export interface ThinkingBlockProps {
  /** The accumulated reasoning summary text (may be empty/undefined). */
  reasoning?: string;
  /** True while reasoning chunks are still arriving for this message. */
  reasoningStreaming?: boolean;
  /** Total time spent reasoning, in milliseconds (set once reasoning finishes). */
  reasoningMs?: number;
}

function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "Thought for a few seconds";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds <= 0) return "Thought for a few seconds";
  return `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * ChatGPT-style collapsible "Thinking" panel rendered above an assistant
 * answer.
 *
 * - While streaming: an auto-expanded, auto-scrolling area with a pulsing
 *   "Thinking…" header and the live reasoning summary.
 * - Once finished: collapses to a clickable "Thought for Ns" pill with a
 *   chevron; clicking re-expands the full reasoning text.
 * - Renders nothing when there is no reasoning and none is in progress.
 */
export function ThinkingBlock({
  reasoning,
  reasoningStreaming,
  reasoningMs,
}: ThinkingBlockProps) {
  const hasText = !!reasoning && reasoning.length > 0;

  // Expanded while streaming; collapses by default once done. The user can
  // toggle it open again afterwards.
  const [expanded, setExpanded] = useState<boolean>(!!reasoningStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the live view expanded during streaming and collapse when it ends.
  useEffect(() => {
    setExpanded(!!reasoningStreaming);
  }, [reasoningStreaming]);

  // Auto-scroll the reasoning area to the bottom as new text streams in.
  useEffect(() => {
    if (!reasoningStreaming) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, reasoningStreaming]);

  // Nothing to show.
  if (!reasoningStreaming && !hasText) return null;

  const open = expanded || !!reasoningStreaming;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => {
          // Don't allow collapsing while the live stream is in progress.
          if (reasoningStreaming) return;
          setExpanded((o) => !o);
        }}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors",
          reasoningStreaming
            ? "cursor-default"
            : "cursor-pointer hover:bg-hover hover:text-text-primary",
        )}
      >
        <Brain size={14} className={cn("opacity-80", reasoningStreaming && "animate-pulse")} />
        {reasoningStreaming ? (
          <span className="animate-pulse font-medium">Thinking…</span>
        ) : (
          <span className="font-medium">{formatDuration(reasoningMs)}</span>
        )}
        {!reasoningStreaming && hasText && (
          <ChevronDown
            size={14}
            className={cn(
              "opacity-60 transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          open ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={scrollRef}
            className={cn(
              "border-l-2 border-border pl-3 text-[13px] leading-relaxed text-text-secondary",
              reasoningStreaming && "max-h-56 overflow-y-auto",
            )}
          >
            {hasText ? (
              <Markdown content={reasoning ?? ""} className="prose-sm opacity-90" />
            ) : (
              <span className="italic opacity-70">Reasoning…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThinkingBlock;
