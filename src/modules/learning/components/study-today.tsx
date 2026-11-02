"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useOptimistic, useRef } from "react";
import { Key } from "@/design-system";
import { KIND_LABELS, LEARNING_COPY as COPY } from "../learning-copy";
import { trackPath } from "../routes";
import { markStepDone, undoMarkStepDone } from "../steps-actions";
import { STEPS_COPY } from "../steps-copy";
import type { StepDoneResult } from "../steps-input";
import type { RunningSession } from "../sessions-input";
import type { LearningTodayTrack } from "../today-summary";
import { StudyKey } from "./study-key";
import { TrackProgress } from "./track-progress";
import { useLearningSave } from "./use-learning-save";
import { useStudyTimer } from "./use-study-timer";
import { WeekLine } from "./week-line";

/** A step checked from a card: the track's counts and «Sigue con» move at once. */
type CardChange = { trackId: string; stepId: string };

export function applyStudyCardChange(
  tracks: LearningTodayTrack[],
  { trackId, stepId }: CardChange,
): LearningTodayTrack[] {
  return tracks.map((track) =>
    track.id === trackId && track.upcoming[0]?.id === stepId
      ? {
          ...track,
          steps: { done: track.steps.done + 1, total: track.steps.total },
          upcoming: track.upcoming.slice(1),
        }
      : track,
  );
}

const linkSelector = (id: string) => `[data-study-card="${CSS.escape(id)}"] [data-track-link]`;
const doneKeySelector = (id: string) => `[data-study-card="${CSS.escape(id)}"] [data-track-done]`;

type StudyTodayCardsProps = {
  /** The tracks in progress (`getLearningTodaySummary`), by their order. */
  tracks: LearningTodayTrack[];
  /** The timer that runs now (any track's), or null. */
  running: RunningSession | null;
  /** The list's accessible name. */
  label: string;
};

/**
 * Hoy's «Sigue con» cards (SPEC-learning "Hoy", L3): one per track in progress with its next step
 * and «Hecho» (optimistic, with «Deshacer»), the steps done of total, this week's time against the
 * target, and «Estudiar» / «Detener» (`useStudyTimer`: the same timer, notices and «¿Cuánto
 * estudiaste?» sheet as /learning). Rendered by `today` inside its board's screen services (one
 * queue, one notice viewport, one announcer). Nothing without tracks; `data-saving` while a change
 * is on its way.
 */
export function StudyTodayCards({ tracks, running, label }: StudyTodayCardsProps) {
  const { save, toaster, announce, saving } = useLearningSave();
  const timer = useStudyTimer(running);
  const [view, applyChange] = useOptimistic(tracks, applyStudyCardChange);

  // Element to focus after the next render (a card's «Hecho» went away, or came back).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  function checkNext(track: LearningTodayTrack) {
    const step = track.upcoming[0];
    if (!step) return;
    // The last step: its «Hecho» goes away, focus goes to the card's title.
    if (track.upcoming.length === 1)
      pendingFocus.current = () => document.querySelector(linkSelector(track.id));
    save<StepDoneResult>({
      apply: () => applyChange({ trackId: track.id, stepId: step.id }),
      key: null,
      call: () => markStepDone({ trackId: track.id, id: step.id, done: true }),
      failure: STEPS_COPY.notSaved.check,
      onSuccess: (result) => {
        toaster.push({
          title: STEPS_COPY.doneTitle,
          text: STEPS_COPY.doneNotice(step.title),
          action: {
            label: COPY.undo,
            run: () =>
              save({
                key: null,
                call: () =>
                  undoMarkStepDone({
                    trackId: track.id,
                    id: step.id,
                    expected: result.step.doneAt,
                    restore: result.previous,
                  }),
                failure: COPY.notUndone,
                onSuccess: () => {
                  announce(STEPS_COPY.undoneNotice(step.title));
                  pendingFocus.current = () => document.querySelector(doneKeySelector(track.id));
                },
              }),
          },
        });
      },
    });
  }

  if (view.length === 0) return timer.sheet;
  return (
    <>
      <ul
        aria-label={label}
        className="grid gap-4 md:grid-cols-2"
        data-saving={saving || timer.busy || undefined}
      >
        {view.map((track) => (
          <StudyCard key={track.id} track={track} onDone={checkNext} timer={timer} />
        ))}
      </ul>
      {timer.sheet}
    </>
  );
}

/** One track in progress: what it is, «Sigue con» and «Hecho», the bar, the week, «Estudiar». */
function StudyCard({
  track,
  onDone,
  timer,
}: {
  track: LearningTodayTrack;
  onDone: (track: LearningTodayTrack) => void;
  timer: ReturnType<typeof useStudyTimer>;
}) {
  const next = track.upcoming[0] ?? null;
  return (
    <li data-study-card={track.id} className="bo-card flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="bo-text-label text-text-secondary">{KIND_LABELS[track.kind]}</span>
        <Link
          href={trackPath(track.id)}
          prefetch={false}
          data-track-link=""
          className="bo-text-title line-clamp-2 min-w-0 rounded-sm break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {track.title}
        </Link>
      </div>
      {track.kind === "practice" ? null : track.steps.total === 0 ? (
        <p className="bo-text-body-sm text-text-secondary">{COPY.noSyllabus}</p>
      ) : next ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <p className="bo-text-body min-w-0 flex-1 break-words" data-track-next="">
            <span className="bo-text-label block text-text-secondary">{COPY.next}</span>
            {next.title}
          </p>
          <Key
            icon={Check}
            aria-label={STEPS_COPY.doneName(next.title)}
            data-track-done={track.id}
            onClick={() => onDone(track)}
          >
            {STEPS_COPY.done}
          </Key>
        </div>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{COPY.allDone}</p>
      )}
      {track.steps.total > 0 ? (
        <TrackProgress title={track.title} done={track.steps.done} total={track.steps.total} />
      ) : null}
      <WeekLine minutes={track.weekMinutes} target={track.weeklyTargetMinutes} />
      <StudyKey
        track={track}
        running={timer.running}
        busy={timer.busy}
        onStart={(from) => timer.start(track, from)}
        onStop={(from) => timer.stop(from)}
      />
    </li>
  );
}
