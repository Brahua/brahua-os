"use client";

// One clock for every running timer on screen (learning's study timer, health's session and rest):
// a single interval while something shows it, cleared when the last one unmounts (CLAUDE.md
// "Timers in components"). The elapsed time is always computed from a stored instant, never by
// adding ticks, so it survives reloads and sleeping tabs.
import { useSyncExternalStore } from "react";

let current = 0;
let interval: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const secondNow = () => Math.floor(Date.now() / 1000) * 1000;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (interval === null) {
    current = secondNow();
    interval = setInterval(() => {
      current = secondNow();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

function getSnapshot() {
  // Before the first subscription (the first render), read the clock once per second.
  if (interval === null) current = secondNow();
  return current;
}

/** No clock on the server: the time shows after hydration (no mismatch with the server's). */
const getServerSnapshot = () => null;

/** The current time, to the second, ticking while mounted; null on the server and in hydration. */
export function useSecondClock(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
