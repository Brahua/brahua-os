"use client";

import { Play, Square } from "lucide-react";
import { Key } from "@/design-system";
import { useSecondClock } from "@/lib/use-second-clock";
import { elapsedMs, formatElapsed } from "../pace";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { RunningSession } from "../sessions-input";

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
