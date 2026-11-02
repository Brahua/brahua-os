"use client";

import { Play, Square } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Key } from "@/design-system";
import { elapsedMs, formatElapsed } from "../pace";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { RunningSession } from "../sessions-input";

// One clock for every running timer on screen: a single interval while something shows it,
// cleared when the last one unmounts (CLAUDE.md "Timers in components"). The elapsed time is always
// computed from `started_at`, never by adding ticks, so it survives reloads and sleeping tabs.
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

/**
 * The running time of a timer («12:34», «1:02:03»). Assistive tech reads «Estudiando: 12 min»
 * instead (it changes once a minute, not every second).
 */
export function ElapsedTime({ startedAt }: { startedAt: string }) {
  const now = useSecondClock();
  const ms = now === null ? null : elapsedMs(startedAt, now);
  return (
    <span className="bo-text-label tabular-nums" data-study-elapsed="">
      <span aria-hidden>{ms === null ? "" : formatElapsed(ms)}</span>
      {ms === null ? null : (
        <span className="sr-only">{COPY.runningName(Math.floor(ms / 60_000))}</span>
      )}
    </span>
  );
}

type StudyKeyProps = {
  track: { id: string; title: string };
  /** The timer that runs now (any track's), or null. */
  running: RunningSession | null;
  busy: boolean;
  onStart: (from: HTMLElement) => void;
  onStop: (from: HTMLElement) => void;
};

/**
 * «Estudiar» / «Detener» of a track with the running time beside it. One key whose label changes:
 * focus stays on it when the timer starts or stops. `aria-disabled` while a change is on its way
 * (never `disabled`: it may hold focus); the handlers guard it too.
 */
export function StudyKey({ track, running, busy, onStart, onStop }: StudyKeyProps) {
  const runningHere = running?.trackId === track.id ? running : null;
  return (
    <div className="flex flex-wrap items-center gap-3" data-study={track.id}>
      <Key
        variant={runningHere ? "default" : "signal"}
        icon={runningHere ? Square : Play}
        aria-label={runningHere ? COPY.stopName(track.title) : COPY.studyName(track.title)}
        aria-disabled={busy || undefined}
        data-study-key={runningHere ? "stop" : "start"}
        onClick={(event) => {
          if (busy) return;
          if (runningHere) onStop(event.currentTarget);
          else onStart(event.currentTarget);
        }}
      >
        {runningHere ? COPY.stop : COPY.study}
      </Key>
      {runningHere ? <ElapsedTime startedAt={runningHere.startedAt} /> : null}
    </div>
  );
}
