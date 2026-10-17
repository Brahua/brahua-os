"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

/** Whether the viewport is a phone's (< 640 px); the server and the first paint say no. */
export function useViewportIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(QUERY).matches
        : false,
    () => false,
  );
}
