"use client";

import { ChevronRight, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Icon, Key, keyClasses, SectionLabel, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { useSecondClock } from "@/lib/use-second-clock";
import type { RotationRoutine } from "../rotation";
import { sessionPath } from "../routes";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { OpenSession } from "../sessions-input";
import { useStartSession } from "./use-start-session";

type SessionStartProps = {
  /** The open session, or null. */
  open: OpenSession | null;
  /** The routine that comes next by the rotation, or null without routines. */
  next: RotationRoutine | null;
  /** The live routines in their order (the «Otra rutina» sheet). */
  routines: readonly { id: string; name: string }[];
};

/**
 * The top of /health (SPEC-health "Pantallas"): the open session with «Seguir», or «Empezar
 * Rutina B» (the one the rotation says) with «Otra rutina» and «Sesión libre».
 */
export function SessionStart({ open, next, routines }: SessionStartProps) {
  const headingId = useId();
  const { start, busy } = useStartSession();
  const isDesktop = useIsDesktop();
  const [picker, setPicker] = useState({ key: 0, open: false });
  const otherKey = useRef<HTMLButtonElement>(null);

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-160 flex-col gap-3"
      data-health-session-start=""
    >
      <SectionLabel id={headingId} as="h2" title={open ? COPY.running : COPY.section} />
      {open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-4">
          <p className="bo-text-body flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium break-words">{COPY.routineOrFree(open.routineName)}</span>
            <RunningMinutes startedAt={open.startedAt} />
          </p>
          <Link
            href={sessionPath(open.id)}
            className={keyClasses({ variant: "signal" })}
            aria-label={COPY.resumeName(COPY.routineOrFree(open.routineName))}
            data-health-resume=""
          >
            {COPY.resume}
            <Icon icon={ChevronRight} size="md" />
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next ? (
            <Key
              variant="signal"
              icon={Play}
              aria-disabled={busy || undefined}
              data-health-start={next.id}
              onClick={() => void start(next.id)}
            >
              {COPY.start(next.name)}
            </Key>
          ) : null}
          {routines.length > 1 ? (
            <Key
              ref={otherKey}
              variant="ghost"
              aria-disabled={busy || undefined}
              data-health-other=""
              onClick={() => {
                if (!busy) setPicker((current) => ({ key: current.key + 1, open: true }));
              }}
            >
              {COPY.otherRoutine}
            </Key>
          ) : null}
          <Key
            variant={next ? "ghost" : "signal"}
            icon={Plus}
            aria-disabled={busy || undefined}
            data-health-start-free=""
            onClick={() => void start(null)}
          >
            {COPY.startFree}
          </Key>
        </div>
      )}
      <Sheet
        key={`routines-${picker.key}`}
        open={picker.open}
        onOpenChange={(value) => setPicker((current) => ({ ...current, open: value }))}
        variant={isDesktop ? "side" : "bottom"}
        title={COPY.pickRoutineTitle}
        returnFocusRef={otherKey}
        focusTitleOnOpen
      >
        <ul aria-label={COPY.pickRoutineList} className="bo-list" data-health-routine-picker="">
          {routines.map((routine) => (
            <li key={routine.id} className="bg-surface">
              <button
                type="button"
                aria-disabled={busy || undefined}
                className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                data-health-pick={routine.id}
                onClick={() => {
                  if (busy) return;
                  setPicker((current) => ({ ...current, open: false }));
                  void start(routine.id);
                }}
              >
                <span className="bo-text-body min-w-0 flex-1 font-medium break-words">
                  {COPY.start(routine.name)}
                </span>
                <Icon icon={Play} size="sm" className="shrink-0 text-text-secondary" />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}

/** «23 min» since the start, every minute (after hydration). */
function RunningMinutes({ startedAt }: { startedAt: string }) {
  const now = useSecondClock();
  if (now === null) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
  return (
    <span className="bo-text-body-sm text-text-secondary tabular-nums">{`${minutes} min`}</span>
  );
}
