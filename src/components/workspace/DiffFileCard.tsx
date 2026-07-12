"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { DiffView } from "./DiffView";
import { StatusBadge, AddDelCounts, PathLabel } from "./bits";
import type { WorkspaceFileDiff } from "@/lib/workspace/types";

/**
 * A collapsible per-file diff card (Codex-borrowed affordance): a clickable
 * header (chevron + status + path + `+N −M`) that toggles the inline
 * {@link DiffView}. Controlled `expanded` so the panel can expand/collapse all.
 */
export function DiffFileCard({
  diff,
  expanded,
  onToggle,
  registerRef,
}: {
  diff: WorkspaceFileDiff;
  expanded: boolean;
  onToggle: () => void;
  /** Lets the panel scroll a card into view when its file is selected. */
  registerRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      className="overflow-hidden rounded-lg border border-border"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-hover/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-text-secondary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-secondary" />
        )}
        <StatusBadge status={diff.status} />
        <PathLabel path={diff.path} className="flex-1" />
        <AddDelCounts adds={diff.adds} dels={diff.dels} />
      </button>
      {expanded && (
        <div className={cn("border-t border-border")}>
          <DiffView hunks={diff.hunks} language={diff.language} />
        </div>
      )}
    </div>
  );
}

export default DiffFileCard;
