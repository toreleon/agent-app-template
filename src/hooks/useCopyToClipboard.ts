"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCopyToClipboardResult {
  copied: boolean;
  copy: (text: string) => Promise<void>;
}

/** Copies text to the clipboard and exposes a transient `copied` flag. */
export function useCopyToClipboard(resetAfterMs = 2000): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback for environments without the async clipboard API.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetAfterMs);
    },
    [resetAfterMs],
  );

  // Clear any pending reset timer on unmount to avoid a setState-after-unmount.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { copied, copy };
}

export default useCopyToClipboard;
