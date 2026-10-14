"use client";

import { useSyncExternalStore } from "react";

// "The screen animates in once per visit": the first time the app is opened in a tab, not every
// time a screen is shown again. A module flag lives as long as the JS of the tab (a reload starts
// again; client navigations keep it), which is exactly that.
let entered = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called once the first screen has mounted; later screens appear without the entry. */
export function markEntered() {
  if (entered) return;
  entered = true;
  listeners.forEach((listener) => listener());
}

/**
 * True while the entry cascade has not played in this tab. The server always says true (it renders
 * the hidden start, so the first paint has no flash); the client says false once `markEntered`
 * ran. Reading it again after that never replays an animation (`initial` only counts on mount).
 */
export function useEntryPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !entered,
    () => true,
  );
}

/** Test helper: back to "nothing has played yet". */
export function resetEntryForTests() {
  entered = false;
  listeners.forEach((listener) => listener());
}
