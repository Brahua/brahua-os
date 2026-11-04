// The prefill of a session's planned sets and the «La vez pasada» line (SPEC-health "Precarga").
// Client-safe and pure.
import type { ExerciseKind } from "./health-constants";
import { EMPTY_SET_VALUES, keepShown, type PreviousSet, type SetValues } from "./sessions-input";
import { formatClock, formatKg, formatKm, formatWeight } from "./weight";

/**
 * The values of `count` planned sets of an exercise: set i takes the i-th done, non-warmup set of
 * the latest finished session that did it (`previous`, in order); past its end, the last one of
 * them (the last done set of the exercise); never done: empty.
 */
export function prefillSets(previous: readonly PreviousSet[], count: number): SetValues[] {
  const last = previous.at(-1);
  return Array.from({ length: count }, (_, index) => {
    const source = previous[index] ?? last;
    return source ? { ...source } : { ...EMPTY_SET_VALUES };
  });
}

/**
 * The previous sets of the n-th block (0-based) of an exercise in a session: the n-th block of it
 * in the latest session that did it (a routine may repeat an exercise); past the last one, the
 * last one; never done: none.
 */
export function previousForOccurrence(
  blocks: readonly PreviousSet[][],
  occurrence: number,
): PreviousSet[] {
  return blocks[occurrence] ?? blocks.at(-1) ?? [];
}

/** One set as the line says it; the first one carries the unit («80 kg × 8», then «80 × 8»). */
function formatPrevious(kind: ExerciseKind, values: SetValues, first: boolean): string {
  const v = keepShown(kind, values);
  switch (kind) {
    case "weight_reps": {
      const weight =
        v.weightGrams === null ? "" : first ? formatKg(v.weightGrams) : formatWeight(v.weightGrams);
      if (v.reps === null) return weight;
      return weight === "" ? `× ${v.reps}` : `${weight} × ${v.reps}`;
    }
    case "reps": {
      const reps = v.reps === null ? "" : first ? `${v.reps} reps` : String(v.reps);
      return v.weightGrams ? `${reps} (+${formatKg(v.weightGrams)})` : reps;
    }
    case "time":
      return v.seconds === null ? "" : formatClock(v.seconds);
    case "cardio": {
      const time = v.seconds === null ? "" : formatClock(v.seconds);
      return v.distanceMeters === null ? time : `${time} · ${formatKm(v.distanceMeters)}`;
    }
  }
}

/** «80 kg × 8 · 80 × 8 · 80 × 7», or null when it was never done. Cardio's sets join with « / ». */
export function previousLine(kind: ExerciseKind, previous: readonly PreviousSet[]): string | null {
  const parts = previous
    .map((values, index) => formatPrevious(kind, values, index === 0))
    .filter((part) => part !== "");
  if (parts.length === 0) return null;
  return parts.join(kind === "cardio" ? " / " : " · ");
}
