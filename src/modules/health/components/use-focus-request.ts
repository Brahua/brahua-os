"use client";

import { useCallback, useEffect, useRef } from "react";

/** How long a focus request waits for its element to render. */
const FOCUS_WAIT_MS = 3_000;

/**
 * Focus after a render: `request(find)` remembers what to focus, and after each render it is
 * focused once `find` returns it (a row that went away hands focus to its neighbour, an editor that
 * closed to its key). A request older than a few seconds is dropped.
 */
export function useFocusRequest() {
  const pending = useRef<{ find: () => HTMLElement | null; at: number } | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    const element = request.find();
    if (element) {
      pending.current = null;
      element.focus();
    } else if (Date.now() - request.at > FOCUS_WAIT_MS) {
      pending.current = null;
    }
  });
  return useCallback((find: () => HTMLElement | null) => {
    pending.current = { find, at: Date.now() };
  }, []);
}
