"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface UseAutoScrollResult<T extends HTMLElement> {
  /** Ref to attach to the scrollable container. */
  containerRef: React.RefObject<T>;
  /** Ref to attach to a sentinel element at the very bottom of the content. */
  bottomRef: React.RefObject<HTMLDivElement>;
  /** True when the view is pinned at (near) the bottom of the scroll container. */
  isPinnedToBottom: boolean;
  /** Programmatically scroll to the bottom. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Keeps a scroll container pinned to the bottom as new content arrives, unless
 * the user has scrolled up. Used by the message list during streaming.
 *
 * `deps` should change whenever content that affects scroll height changes
 * (e.g. message count, streaming text length).
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  deps: ReadonlyArray<unknown>,
): UseAutoScrollResult<T> {
  const containerRef = useRef<T>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const pinnedRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Track whether the user is near the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distanceFromBottom < 80;
      pinnedRef.current = pinned;
      setIsPinnedToBottom(pinned);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // When tracked deps change, follow the bottom if we were pinned there.
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, bottomRef, isPinnedToBottom, scrollToBottom };
}

export default useAutoScroll;
