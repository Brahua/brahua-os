"use client";

import { EllipsisVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { IconKey, Key } from "@/design-system";
import { EXERCISES_COPY } from "../exercises-copy";
import { formatDuration } from "../format";
import { MAX_EXERCISE_SETS } from "../health-constants";
import { previousLine } from "../prefill";
import { exercisePath } from "../routes";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import {
  SET_FIELDS,
  type SessionExercise,
  type SessionSet,
  type SetValues,
} from "../sessions-input";
import { SetRow } from "./set-row";
import { useRowMenu } from "./use-row-menu";

/** The column a value shows in, by kind (the header over the sets). */
const COLUMN: Record<keyof SetValues, (kind: SessionExercise["kind"]) => string> = {
  weightGrams: (kind) => (kind === "reps" ? COPY.columnExtraKg : COPY.columnKg),
  reps: () => COPY.columnReps,
  seconds: () => COPY.columnTime,
  distanceMeters: () => COPY.columnKm,
};

/** The rest a session's exercise takes: its own (copied from the routine), or the exercise's. */
export const restOf = (exercise: SessionExercise) =>
  exercise.restSeconds ?? exercise.exerciseRestSeconds;

export type SetHandlers = {
  onValues: (exercise: SessionExercise, set: SessionSet, values: SetValues) => void;
  onDone: (
    exercise: SessionExercise,
    set: SessionSet,
    done: boolean,
    values: SetValues,
    from: HTMLElement,
  ) => void;
  onWarmup: (exercise: SessionExercise, set: SessionSet, warmup: boolean) => void;
  onRemoveSet: (exercise: SessionExercise, set: SessionSet) => void;
  onRetry: (set: SessionSet) => void;
  /** A set's row holds text that doesn't parse (or no longer does). */
  onDraftHeld: (setId: string, held: boolean) => void;
  onAddSet: (exercise: SessionExercise) => void;
  onRemoveExercise: (exercise: SessionExercise) => void;
};

type ExerciseBlockProps = SetHandlers & {
  exercise: SessionExercise;
  /** Ids of the sets whose last save failed on the network. */
  unsaved: ReadonlySet<string>;
};

/**
 * One exercise of a session (SPEC-health "Pantallas"): its name (a link to its page), «La vez
 * pasada», its rest, its sets and «Añadir serie» (a copy of the last one); its menu removes it from
 * the session (with «Deshacer»). Nothing here touches the routine.
 */
export function ExerciseBlock({ exercise, unsaved, ...handlers }: ExerciseBlockProps) {
  const headingId = useId();
  const menu = useRowMenu();
  const line = previousLine(exercise.kind, exercise.previous);
  const full = exercise.sets.length >= MAX_EXERCISE_SETS;
  const fields = SET_FIELDS[exercise.kind].shown;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg bg-surface p-3 sm:p-4"
      data-session-exercise={exercise.id}
    >
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={headingId} className="bo-text-heading break-words">
            <Link
              href={exercisePath(exercise.exerciseId)}
              prefetch={false}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {exercise.name}
            </Link>
          </h2>
          <p className="bo-text-body-sm text-text-secondary" data-previous="">
            {line ? COPY.previous(line) : COPY.previousNone}
          </p>
          <p className="bo-text-body-sm text-text-secondary">
            {COPY.restLine(formatDuration(restOf(exercise)))}
            {exercise.perDumbbell ? ` · ${EXERCISES_COPY.perDumbbell}` : ""}
          </p>
        </div>
        <IconKey
          icon={EllipsisVertical}
          label={COPY.exerciseMenu(exercise.name)}
          variant="ghost"
          tooltip={false}
          data-exercise-menu={exercise.id}
          {...menu.keyProps}
        />
      </header>
      {menu.open ? (
        <div className="flex flex-wrap gap-2" {...menu.panelProps}>
          <Key
            variant="ghost"
            icon={Trash2}
            data-exercise-remove={exercise.id}
            onClick={() => {
              menu.close();
              handlers.onRemoveExercise(exercise);
            }}
          >
            {COPY.removeExercise}
          </Key>
        </div>
      ) : null}

      {exercise.sets.length > 0 ? (
        <>
          {/* The columns, for the eye; each field says its own name to assistive tech. */}
          <div aria-hidden className="bo-set-grid bo-text-label text-center text-text-secondary">
            <span>{COPY.columnSet}</span>
            {fields.map((field) => (
              <span key={field}>{COLUMN[field](exercise.kind)}</span>
            ))}
            {fields.length === 1 ? <span /> : null}
            <span>{COPY.columnDone}</span>
            <span />
          </div>
          <ol aria-label={COPY.setsLabel(exercise.name)} className="flex flex-col gap-2">
            {exercise.sets.map((set, index) => (
              <li key={set.id}>
                <SetRow
                  kind={exercise.kind}
                  exerciseName={exercise.name}
                  set={set}
                  index={index}
                  unsaved={unsaved.has(set.id)}
                  onValues={(values) => handlers.onValues(exercise, set, values)}
                  onDone={(done, values, from) =>
                    handlers.onDone(exercise, set, done, values, from)
                  }
                  onWarmup={(warmup) => handlers.onWarmup(exercise, set, warmup)}
                  onRemove={() => handlers.onRemoveSet(exercise, set)}
                  onRetry={() => handlers.onRetry(set)}
                  onDraftHeld={(held) => handlers.onDraftHeld(set.id, held)}
                />
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <Key
        icon={Plus}
        variant="ghost"
        className="self-start"
        aria-disabled={full || undefined}
        data-add-set={exercise.id}
        onClick={() => {
          if (!full) handlers.onAddSet(exercise);
        }}
      >
        {COPY.addSet}
      </Key>
    </section>
  );
}
