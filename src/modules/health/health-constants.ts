// Plain constants of `health` shared by the Zod schemas (client and server) and the database
// CHECK constraints (SPEC-health "Modelo de datos"). No server code: the client imports them.

/**
 * How an exercise is measured (SPEC-health "Tipos de ejercicio"): weight × reps, reps (optional
 * extra weight), time (seconds), or cardio (time and optional distance).
 */
export const EXERCISE_KINDS = ["weight_reps", "reps", "time", "cardio"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** The kinds a routine targets with repetitions (min–max); the others with seconds. */
export const REPS_KINDS: readonly ExerciseKind[] = ["weight_reps", "reps"];
export const usesReps = (kind: ExerciseKind) => REPS_KINDS.includes(kind);

/** Muscle groups (ids in English, labels in exercises-copy.ts). */
export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "full_body",
  "cardio",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** Equipment (ids in English, labels in exercises-copy.ts). */
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "kettlebell",
  "band",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EXERCISE_NAME_MAX_LENGTH = 80;
export const ROUTINE_NAME_MAX_LENGTH = 60;

/** An exercise's default rest, and the bounds of any rest (the exercise's or a routine item's). */
export const DEFAULT_REST_SECONDS = 90;
export const REST_MIN_SECONDS = 30;
export const REST_MAX_SECONDS = 600;

/** A routine item's targets (SPEC-health "Rutinas"). */
export const TARGET_SETS_MIN = 1;
export const TARGET_SETS_MAX = 10;
export const TARGET_REPS_MIN = 1;
export const TARGET_REPS_MAX = 100;
export const TARGET_SECONDS_MIN = 1;
export const TARGET_SECONDS_MAX = 36_000;

/** A routine holds at most this many live exercises. */
export const MAX_ROUTINE_ITEMS = 30;
/** At most this many live routines (a bound for the reorder's id list). */
export const MAX_ROUTINES = 100;

/** What a routine item starts with when added from the picker, by the exercise's kind. */
export const DEFAULT_TARGETS: Record<
  ExerciseKind,
  {
    targetSets: number;
    repsMin: number | null;
    repsMax: number | null;
    targetSeconds: number | null;
  }
> = {
  weight_reps: { targetSets: 3, repsMin: 8, repsMax: 12, targetSeconds: null },
  reps: { targetSets: 3, repsMin: 8, repsMax: 12, targetSeconds: null },
  time: { targetSets: 3, repsMin: null, repsMax: null, targetSeconds: 30 },
  cardio: { targetSets: 1, repsMin: null, repsMax: null, targetSeconds: 1_200 },
};
