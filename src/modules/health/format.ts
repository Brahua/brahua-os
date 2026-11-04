// How `health` writes durations and targets (SPEC-health "Rutinas"). Client-safe and pure.
import { usesReps, type ExerciseKind } from "./health-constants";

/** «45 s», «2 min», «1 min 30 s», «1 h 5 min». */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} s`);
  return parts.join(" ");
}

export type Targets = {
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
};

/** «4 × 8–10», «4 × 8» (min = max), «3 × 30 s», «1 × 20 min»; just «3 series» without a target. */
export function formatTargets(kind: ExerciseKind, targets: Targets): string {
  const { targetSets, repsMin, repsMax, targetSeconds } = targets;
  if (usesReps(kind) && repsMin !== null && repsMax !== null) {
    return `${targetSets} × ${repsMin === repsMax ? repsMin : `${repsMin}–${repsMax}`}`;
  }
  if (!usesReps(kind) && targetSeconds !== null) {
    return `${targetSets} × ${formatDuration(targetSeconds)}`;
  }
  return `${targetSets} ${targetSets === 1 ? "serie" : "series"}`;
}

/** The rests the forms offer, in seconds (any 30–600 is valid; a stored one outside joins them). */
export const REST_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 420, 600] as const;

/** REST_CHOICES plus `current` when it isn't one of them, in order. */
export function restChoices(current: number | null): number[] {
  const choices: number[] = [...REST_CHOICES];
  if (current !== null && !choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => a - b);
}
