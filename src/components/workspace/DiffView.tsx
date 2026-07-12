"use client";

import { cn } from "@/components/ui/cn";
import { highlightLine } from "./diffHighlight";
import type { DiffHunk, DiffLine } from "@/lib/workspace/types";

/**
 * Unified (inline) diff renderer for one file's hunks — Claude-Code-Desktop
 * style: dual old/new line-number gutters, green added rows, red removed rows,
 * neutral context, `@@` hunk-header separators, syntax-highlighted code. The
 * body scrolls horizontally as a unit for long lines.
 */
export function DiffView({
  hunks,
  language,
}: {
  hunks: DiffHunk[];
  language?: string;
}) {
  if (hunks.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-secondary">
        No textual changes.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      <div className="min-w-full">
        {hunks.map((hunk, hi) => (
          <div key={hi}>
            <div className="flex w-max min-w-full bg-hover/60 text-text-secondary">
              <span className="select-none px-3 py-0.5 tabular-nums">
                {hunk.header}
              </span>
            </div>
            {hunk.lines.map((line, li) => (
              <Row key={`${hi}-${li}`} line={line} language={language} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ line, language }: { line: DiffLine; language?: string }) {
  const isAdd = line.type === "add";
  const isDel = line.type === "del";
  const html =
    line.content === "" ? " " : highlightLine(line.content, language);
  return (
    <div
      className={cn(
        "flex w-max min-w-full",
        isAdd && "bg-green-500/15",
        isDel && "bg-red-500/15",
      )}
    >
      <Gutter n={line.oldNo} />
      <Gutter n={line.newNo} />
      <span
        aria-hidden
        className={cn(
          "w-4 shrink-0 select-none text-center",
          isAdd && "text-green-500",
          isDel && "text-red-500",
          !isAdd && !isDel && "text-transparent",
        )}
      >
        {isAdd ? "+" : isDel ? "-" : " "}
      </span>
      <code
        className="whitespace-pre pr-4 text-text-primary"
        // highlightLine returns hljs-escaped HTML (or an nbsp); safe to inject.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function Gutter({ n }: { n: number | null }) {
  return (
    <span className="w-10 shrink-0 select-none px-2 text-right tabular-nums text-text-secondary/50">
      {n ?? ""}
    </span>
  );
}

export default DiffView;
