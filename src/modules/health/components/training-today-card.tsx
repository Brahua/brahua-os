"use client";

import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { Icon, Key, keyClasses } from "@/design-system";
import { useSecondClock } from "@/lib/use-second-clock";
import { sessionPath } from "../routes";
import { SESSIONS_COPY } from "../sessions-copy";
import type { TrainingCard } from "../today-summary";
import { TRAINING_COPY as COPY } from "../training-copy";
import { useStartSession } from "./use-start-session";

/**
 * Hoy's «Entreno» card (SPEC-health "Hoy", E4), rendered by `today` inside its board's screen
 * services: the open session («Entreno en curso · Rutina A · 23 min» and «Seguir»), or «Empezar
 * <la que toca>» (starts it and opens it, `useStartSession`); another routine is one tap away in
 * the section's «Ver entreno» (/health). The card to show comes from `trainingCard`.
 */
export function TrainingTodayCard({ card }: { card: Exclude<TrainingCard, null> }) {
  if (card.kind === "running") return <RunningCard card={card} />;
  return <StartCard card={card} />;
}

function RunningCard({ card }: { card: Extract<TrainingCard, { kind: "running" }> }) {
  const now = useSecondClock();
  const routine = SESSIONS_COPY.routineOrFree(card.routineName);
  const minutes =
    now === null ? null : Math.max(0, Math.floor((now - Date.parse(card.startedAt)) / 60_000));
  return (
    <div className="bo-card max-w-160 items-start gap-3" data-training-card="running">
      <p className="bo-text-body flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{COPY.running}</span>
        <span className="bo-text-body-sm break-words text-text-secondary tabular-nums">
          {COPY.runningLine(routine, minutes)}
        </span>
      </p>
      <Link
        href={sessionPath(card.id)}
        className={keyClasses({ variant: "signal" })}
        aria-label={COPY.resumeName(routine)}
        data-training-resume=""
      >
        {COPY.resume}
        <Icon icon={ChevronRight} size="md" />
      </Link>
    </div>
  );
}

function StartCard({ card }: { card: Extract<TrainingCard, { kind: "start" }> }) {
  const { start, busy } = useStartSession();
  return (
    <div className="bo-card max-w-160 items-start gap-3" data-training-card="start">
      <p className="bo-text-body font-medium">{COPY.nextTitle}</p>
      {/* «Otra rutina» is the section's «Ver entreno» (/health), one link instead of two. */}
      <Key
        variant="signal"
        icon={Play}
        className="h-auto max-w-full py-2"
        aria-disabled={busy || undefined}
        data-training-start={card.routineId}
        onClick={() => void start(card.routineId)}
      >
        <span className="min-w-0 text-left break-words">{COPY.start(card.routineName)}</span>
      </Key>
    </div>
  );
}
