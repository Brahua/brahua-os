"use client";

import { useSyncExternalStore } from "react";

// Same breakpoint as the shell (Tailwind `lg`): side panel next to the sidebar, bottom sheet below.
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True from 1024 px. False on the server: use it for things that only show after hydration
 * (e.g. a sheet that opens on a tap), so the server value never shows.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}
