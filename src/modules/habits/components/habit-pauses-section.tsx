"use client";

import { CalendarX, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Key } from "@/design-system";
import type { HabitPauseSummary } from "../habit-input";
import { HISTORY_COPY } from "../history-copy";
import { PAUSE_COPY } from "../pause-copy";
import { FoldedSection } from "./habit-sections";
import { preloadPause } from "./use-pause-flow";

type HabitPausesSectionProps = {
  /** Every pause that isn't removed (as shown: optimistic), by start date. */
  pauses: readonly HabitPauseSummary[];
  today: string;
  /** Archived: nothing can be paused or resumed (the server refuses it). */
  archived: boolean;
  headingId: string;
  /** Whether a change of that pause is on its way (its key is aria-disabled meanwhile). */
  isBusy: (pause: HabitPauseSummary) => boolean;
  onPause: (trigger: HTMLElement) => void;
  onResume: (pause: HabitPauseSummary) => void;
};

/**
 * H5: the pauses on a habit's page (SPEC-habits "Detalle"): the current and planned ones, each
 * with "Reanudar" (or "Cancelar la pausa" when it hasn't started), "Pausar" (the H4 sheet; not
 * while paused today) and the past ones, folded.
 */
export function HabitPausesSection({
  pauses,
  today,
  archived,
  headingId,
  isBusy,
  onPause,
  onResume,
}: HabitPausesSectionProps) {
  const [pastOpen, setPastOpen] = useState(false);
  const upcoming = pauses.filter((pause) => pause.endDate >= today);
  const past = pauses.filter((pause) => pause.endDate < today).reverse();
  const pausedToday = upcoming.some((pause) => pause.startDate <= today);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-habit-pauses="">
      {/* tabIndex -1: focus lands here when a resumed pause's key leaves. */}
      <h2 id={headingId} tabIndex={-1} className="bo-text-title outline-none">
        {HISTORY_COPY.pausesHeading}
      </h2>
      <p className="bo-text-body-sm text-text-secondary">{HISTORY_COPY.pausesHelp}</p>
      {upcoming.length > 0 ? (
        <ul aria-label={HISTORY_COPY.pausesList} className="bo-list">
          {upcoming.map((pause) => {
            const now = pause.startDate <= today;
            const range = HISTORY_COPY.pauseRange(pause.startDate, pause.endDate, pause.reason);
            return (
              <li
                key={pause.id}
                data-habit-pause={pause.id}
                className="flex min-h-14 items-center gap-2 bg-surface py-1 pr-2 pl-4"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                  <span className="bo-text-body break-words">{range}</span>
                  <span className="bo-text-label text-text-secondary">
                    {now ? HISTORY_COPY.pauseNow : HISTORY_COPY.pauseAhead}
                  </span>
                </span>
                {archived ? null : (
                  <Key
                    variant="ghost"
                    icon={now ? Play : CalendarX}
                    aria-label={
                      now ? HISTORY_COPY.resumeHelp(range) : HISTORY_COPY.cancelHelp(range)
                    }
                    // Never `disabled` (it may have focus): the page guards a second activation.
                    aria-disabled={isBusy(pause) || undefined}
                    onClick={() => onResume(pause)}
                  >
                    <span className="max-sm:sr-only">
                      {now ? PAUSE_COPY.resume : PAUSE_COPY.cancelPause}
                    </span>
                  </Key>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="bo-text-body-sm">{HISTORY_COPY.noPauses}</p>
      )}
      {archived || pausedToday ? null : (
        <div className="flex flex-col items-start gap-2">
          <Key
            variant="ghost"
            icon={Pause}
            aria-haspopup="dialog"
            onPointerEnter={preloadPause}
            onFocus={preloadPause}
            onTouchStart={preloadPause}
            onClick={(event) => onPause(event.currentTarget)}
          >
            {PAUSE_COPY.pause}
          </Key>
        </div>
      )}
      {past.length > 0 ? (
        <FoldedSection
          title={HISTORY_COPY.pastPauses}
          count={past.length}
          expanded={pastOpen}
          onExpandedChange={setPastOpen}
          name="past-pauses"
          level={3}
        >
          <ul aria-label={HISTORY_COPY.pastPausesList} className="bo-list">
            {past.map((pause) => (
              <li key={pause.id} className="flex min-h-12 items-center bg-surface px-4 py-2">
                <span className="bo-text-body-sm break-words">
                  {HISTORY_COPY.pauseRange(pause.startDate, pause.endDate, pause.reason)}
                </span>
              </li>
            ))}
          </ul>
        </FoldedSection>
      ) : null}
    </section>
  );
}
