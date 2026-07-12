"use client";

import { cn } from "@/components/ui/cn";
import type { FileStatus } from "@/lib/workspace/types";

const STATUS_META: Record<FileStatus, { label: string; cls: string; title: string }> = {
  A: { label: "A", cls: "bg-green-500/15 text-green-500", title: "Added" },
  M: { label: "M", cls: "bg-amber-500/15 text-amber-500", title: "Modified" },
  D: { label: "D", cls: "bg-red-500/15 text-red-500", title: "Deleted" },
};

/** Small colored single-letter git status pill (A/M/D). */
export function StatusBadge({ status }: { status: FileStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      title={m.title}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

/** `+N −M` add/remove counts, green/red. */
export function AddDelCounts({
  adds,
  dels,
  className,
}: {
  adds: number;
  dels: number;
  className?: string;
}) {
  return (
    <span className={cn("shrink-0 tabular-nums text-[11px]", className)}>
      {adds > 0 && <span className="text-green-500">+{adds}</span>}
      {adds > 0 && dels > 0 && <span className="text-text-secondary"> </span>}
      {dels > 0 && <span className="text-red-500">−{dels}</span>}
      {adds === 0 && dels === 0 && <span className="text-text-secondary">0</span>}
    </span>
  );
}

/** A path rendered as bold basename + muted directory prefix. */
export function PathLabel({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const idx = path.lastIndexOf("/");
  const dir = idx >= 0 ? path.slice(0, idx + 1) : "";
  const base = idx >= 0 ? path.slice(idx + 1) : path;
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {dir && <span className="text-text-secondary">{dir}</span>}
      <span className="font-medium text-text-primary">{base}</span>
    </span>
  );
}
