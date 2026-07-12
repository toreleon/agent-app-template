"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Check, ChevronDown, Loader2, X } from "lucide-react";
import type {
  SubagentActivity as SubagentActivityEntry,
  SubagentState,
  SubagentStatus,
} from "@/lib/types";
import { cn } from "@/components/ui/cn";

export interface SubagentActivityProps {
  /** The accumulated parallel-subagent state (one entry per dispatched worker). */
  subagents: SubagentState;
  /** True while events are still arriving for this message. */
  isStreaming?: boolean;
}

/** The trailing status indicator for one worker: spinner / check / x. */
function StatusIcon({ status }: { status: SubagentStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2 size={13} className="shrink-0 animate-spin text-text-secondary" />
      );
    case "done":
      return <Check size={13} className="shrink-0 text-accent" />;
    case "failed":
      return <X size={13} className="shrink-0 text-red-400" />;
    default:
      return null;
  }
}

function AgentRow({ agent }: { agent: SubagentActivityEntry }) {
  const steps = agent.steps ?? 0;
  return (
    <div className="flex items-center gap-2 py-0.5 text-[13px] leading-relaxed">
      <StatusIcon status={agent.status} />
      <span
        className="shrink-0 max-w-[45%] truncate font-medium text-text-primary"
        title={agent.title}
      >
        {agent.title}
      </span>
      {agent.detail && (
        <span
          className="min-w-0 flex-1 truncate text-text-secondary"
          title={agent.detail}
        >
          {agent.detail}
        </span>
      )}
      {steps > 0 && (
        <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-text-secondary opacity-70">
          {steps} {steps === 1 ? "step" : "steps"}
        </span>
      )}
    </div>
  );
}

/**
 * ChatGPT/Claude-style collapsible "Subagents" activity block rendered above an
 * orchestrator's synthesized answer, showing the parallel workers dispatched by
 * the `run_subagents` tool.
 *
 * - While any worker is still running: auto-expanded, auto-scrolling, with a
 *   pulsing "Working with N subagents…" header.
 * - Once every worker has settled: collapses to a clickable "Used N subagents"
 *   pill with a chevron; clicking re-expands the per-worker log.
 * - Renders nothing when there are no workers.
 */
export function SubagentActivity({ subagents, isStreaming }: SubagentActivityProps) {
  const agents = subagents.agents ?? [];
  const count = agents.length;

  // "Active" while streaming AND at least one worker is still running. Once all
  // workers settle, the lead agent is synthesizing — collapse to the pill.
  const active =
    !!isStreaming && agents.some((a) => a.status === "running");

  // Expanded while active; collapses by default once done. The user can toggle
  // it open again afterwards.
  const [expanded, setExpanded] = useState<boolean>(active);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the live view expanded during the run and collapse when it ends.
  useEffect(() => {
    setExpanded(active);
  }, [active]);

  // Auto-scroll the log to the newest activity as workers report in.
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active, count]);

  if (count === 0) return null;

  const open = expanded || active;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => {
          // Don't allow collapsing while workers are still running.
          if (active) return;
          setExpanded((o) => !o);
        }}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors",
          active
            ? "cursor-default"
            : "cursor-pointer hover:bg-hover hover:text-text-primary",
        )}
      >
        <Boxes size={14} className={cn("opacity-80", active && "animate-pulse")} />
        {active ? (
          <span className="animate-pulse font-medium">
            Working with {count} {count === 1 ? "subagent" : "subagents"}…
          </span>
        ) : (
          <span className="font-medium">
            Used {count} {count === 1 ? "subagent" : "subagents"}
          </span>
        )}
        {!active && (
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
              "flex flex-col border-l-2 border-border pl-3",
              active && "max-h-72 overflow-y-auto",
            )}
          >
            {agents.map((a) => (
              <AgentRow key={a.id} agent={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SubagentActivity;
