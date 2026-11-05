// Validation and client types of the sessions, their exercises and sets (E2, SPEC-health "Serie",
// "Durante la sesión", "Terminar"). Client-safe: the screen runs the same rules first so a set
// can't be marked without its values; the actions are the authority. Every write names its
// session, and the data layer checks the rows are really its (sessions.ts).
import { z } from "zod";
import { hasInvisibleCharacters } from "@/lib/text";
import {
  DISTANCE_MAX_METERS,
  MAX_EXERCISE_SETS,
  MAX_SESSION_EXERCISES,
  SESSION_NOTE_MAX_LENGTH,
  SET_REPS_MAX,
  SET_REPS_MIN,
  SET_SECONDS_MAX,
  SET_SECONDS_MIN,
  WEIGHT_MAX_GRAMS,
  WEIGHT_STEP_GRAMS,
  type Equipment,
  type ExerciseKind,
} from "./health-constants";
import type { SessionRecord } from "./records";
import { SESSION_ERRORS as ERRORS } from "./sessions-copy";

/** A set's values (any may be empty while it is planned). */
export type SetValues = {
  weightGrams: number | null;
  reps: number | null;
  seconds: number | null;
  distanceMeters: number | null;
};

export const EMPTY_SET_VALUES: SetValues = {
  weightGrams: null,
  reps: null,
  seconds: null,
  distanceMeters: null,
};

/** A set as the session screen shows it. */
export type SessionSet = SetValues & {
  id: string;
  /** Contiguous per exercise (0…n-1). */
  position: number;
  warmup: boolean;
  /** ISO instant it was marked done, or null (planned). */
  doneAt: string | null;
};

/** One done set of an earlier session: «La vez pasada» (prefill.ts). */
export type PreviousSet = SetValues;

/** An exercise of a session with its sets. */
export type SessionExercise = {
  id: string;
  exerciseId: string;
  name: string;
  kind: ExerciseKind;
  equipment: Equipment;
  perDumbbell: boolean;
  /** Copied from the routine when the session started; null: the exercise's. */
  restSeconds: number | null;
  /** The exercise's own rest. */
  exerciseRestSeconds: number;
  /** Contiguous per session (0…n-1). */
  position: number;
  sets: SessionSet[];
  /**
   * The done, non-warmup sets of this exercise in the latest finished session before this one
   * (in order), or empty when it was never done.
   */
  previous: PreviousSet[];
};

/** A session for its screen. */
export type SessionDetail = {
  id: string;
  routineId: string | null;
  /** The routine's name (also when the routine was deleted later), or null: «Sesión libre». */
  routineName: string | null;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  /** Stamped to the millisecond by every write: the «Deshacer» of «Terminar» compares it. */
  updatedAt: string;
  exercises: SessionExercise[];
};

/** A row of «Últimas sesiones» and /health/sessions. */
export type SessionSummary = {
  id: string;
  routineName: string | null;
  startedAt: string;
  endedAt: string | null;
  doneSets: number;
  /** New records in it (E3; 0 while open). */
  newRecords: number;
};

/** The open session, for «Seguir». */
export type OpenSession = { id: string; routineName: string | null; startedAt: string };

/** «Empezar»: the new session, or the one already open (refused: «Ya tienes un entreno en curso»). */
export type StartResult = { started: true; id: string } | { started: false; openId: string };

/** What «Terminar» removed and what its «Deshacer» sends back. */
export type FinishResult = {
  id: string;
  endedAt: string;
  updatedAt: string;
  /** The planned (unmarked) sets it removed: «Deshacer» restores exactly these. */
  removedSetIds: string[];
  /** The new records it set (E3): the summary lists them and the screen celebrates. */
  records: SessionRecord[];
};

/** A session's start and end (the times of a finished one). */
export type SessionTimes = { startedAt: string; endedAt: string | null; updatedAt: string };

// ── The values a set needs ───────────────────────────────────────────────────────────────

/** Which values each kind shows, and which a done set must have (SPEC-health "Serie"). */
export const SET_FIELDS: Record<
  ExerciseKind,
  { shown: readonly (keyof SetValues)[]; required: readonly (keyof SetValues)[] }
> = {
  weight_reps: { shown: ["weightGrams", "reps"], required: ["weightGrams", "reps"] },
  // Reps, with an optional extra weight.
  reps: { shown: ["reps", "weightGrams"], required: ["reps"] },
  time: { shown: ["seconds"], required: ["seconds"] },
  // Time, with an optional distance.
  cardio: { shown: ["seconds", "distanceMeters"], required: ["seconds"] },
};

/** The first value a done set of `kind` lacks, or null when it can be marked. */
export function missingValue(kind: ExerciseKind, values: SetValues): keyof SetValues | null {
  return SET_FIELDS[kind].required.find((field) => values[field] === null) ?? null;
}

/** The values a set of `kind` keeps: the ones it doesn't show are dropped (null). */
export function keepShown(kind: ExerciseKind, values: SetValues): SetValues {
  const shown = SET_FIELDS[kind].shown;
  return {
    weightGrams: shown.includes("weightGrams") ? values.weightGrams : null,
    reps: shown.includes("reps") ? values.reps : null,
    seconds: shown.includes("seconds") ? values.seconds : null,
    distanceMeters: shown.includes("distanceMeters") ? values.distanceMeters : null,
  };
}

// ── Schemas ──────────────────────────────────────────────────────────────────────────────

const sessionId = z.uuid({ error: ERRORS.notFound });
const exerciseRowId = z.uuid({ error: ERRORS.exerciseNotFound });
const setId = z.uuid({ error: ERRORS.setNotFound });

const int = (message: string, min: number, max: number) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

const setValuesShape = {
  weightGrams: int(ERRORS.weight, 0, WEIGHT_MAX_GRAMS)
    .refine((grams) => grams % WEIGHT_STEP_GRAMS === 0, ERRORS.weight)
    .nullable(),
  reps: int(ERRORS.reps, SET_REPS_MIN, SET_REPS_MAX).nullable(),
  seconds: int(ERRORS.seconds, SET_SECONDS_MIN, SET_SECONDS_MAX).nullable(),
  distanceMeters: int(ERRORS.distance, 0, DISTANCE_MAX_METERS).nullable(),
};

/** A set of distinct ids (a reorder): checked against the live set by the data layer. */
const idSet = (max: number) =>
  z
    .array(z.uuid({ error: ERRORS.order }), { error: ERRORS.order })
    .min(1, ERRORS.order)
    .max(max, ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, ERRORS.order);

/** An instant the client sends (ISO 8601 with offset). */
const instant = z.iso.datetime({ offset: true, error: ERRORS.time });

/** «Empezar»: from a routine, or free (null). */
export const startSessionInputSchema = z.object({
  routineId: z.uuid({ error: ERRORS.routineNotFound }).nullable(),
});
export type StartSessionInput = z.output<typeof startSessionInputSchema>;

export const sessionRefInputSchema = z.object({ sessionId });
export type SessionRefInput = z.output<typeof sessionRefInputSchema>;

/** «Agregar ejercicio»: the id comes from the client (later edits queue behind this call). */
export const addExerciseInputSchema = z.object({
  sessionId,
  id: exerciseRowId,
  exerciseId: z.uuid({ error: ERRORS.exerciseUnavailable }),
});
export type AddExerciseInput = z.output<typeof addExerciseInputSchema>;

export const exerciseRefInputSchema = z.object({ sessionId, id: exerciseRowId });
export type ExerciseRefInput = z.output<typeof exerciseRefInputSchema>;

/** «Deshacer» of a remove: back after the neighbour it had (else at `position`). */
export const restoreExerciseInputSchema = z.object({
  sessionId,
  id: exerciseRowId,
  afterId: z.uuid({ error: ERRORS.order }).nullable().default(null),
  position: int(ERRORS.order, 0, MAX_SESSION_EXERCISES),
});
export type RestoreExerciseInput = z.output<typeof restoreExerciseInputSchema>;

export const reorderExercisesInputSchema = z.object({
  sessionId,
  ids: idSet(MAX_SESSION_EXERCISES),
});
export type ReorderExercisesInput = z.output<typeof reorderExercisesInputSchema>;

/** «Añadir serie»: at the end of the exercise, with the values it copies from the one before. */
export const addSetInputSchema = z.object({
  sessionId,
  sessionExerciseId: exerciseRowId,
  id: setId,
  ...setValuesShape,
  warmup: z.boolean({ error: ERRORS.order }),
});
export type AddSetInput = z.output<typeof addSetInputSchema>;

/**
 * A set, sent whole (its values, «Calentamiento» and «hecha»): the newest edit of a set replaces
 * the ones still waiting (the queue collapses them), so the last one sent is what stays.
 */
export const updateSetInputSchema = z.object({
  sessionId,
  id: setId,
  ...setValuesShape,
  warmup: z.boolean({ error: ERRORS.order }),
  done: z.boolean({ error: ERRORS.order }),
});
export type UpdateSetInput = z.output<typeof updateSetInputSchema>;

export const setRefInputSchema = z.object({ sessionId, id: setId });
export type SetRefInput = z.output<typeof setRefInputSchema>;

/** «Deshacer» of removing a set: back after the neighbour it had (else at `position`). */
export const restoreSetInputSchema = z.object({
  sessionId,
  id: setId,
  afterId: z.uuid({ error: ERRORS.order }).nullable().default(null),
  position: int(ERRORS.order, 0, MAX_EXERCISE_SETS),
});
export type RestoreSetInput = z.output<typeof restoreSetInputSchema>;

/**
 * A session's note: NFC, line breaks kept (\r\n as \n), trimmed; empty is no note. ≤ 500
 * characters, no invisible or control characters other than the line break.
 */
export const sessionNoteSchema = z
  .string({ error: ERRORS.noteTooLong })
  .max(5_000, ERRORS.noteTooLong)
  .transform((value) => value.normalize("NFC").replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .refine((value) => [...value].length <= SESSION_NOTE_MAX_LENGTH, ERRORS.noteTooLong)
      // The line break is the only control character allowed (a tab is refused like the rest).
      .refine((value) => !hasInvisibleCharacters(value.replace(/\n/g, "")), ERRORS.invisible),
  )
  .transform((value) => (value === "" ? null : value));

export const updateNoteInputSchema = z.object({ sessionId, note: sessionNoteSchema });
export type UpdateNoteInput = z.output<typeof updateNoteInputSchema>;

/**
 * «Terminar»: `endedAt` is the end the sheet proposes after 4 h (edited by the owner), or null
 * for now. The server keeps it between the start and now.
 */
export const finishSessionInputSchema = z.object({
  sessionId,
  endedAt: instant.nullable().default(null),
  note: sessionNoteSchema,
});
export type FinishSessionInput = z.output<typeof finishSessionInputSchema>;

/**
 * «Deshacer» of «Terminar»: the stamp it left (nobody touched the session since). Which sets come
 * back is the server's: those «Terminar» stamped, never a list from the client.
 */
export const undoFinishInputSchema = z.object({ sessionId, updatedAt: instant });
export type UndoFinishInput = z.output<typeof undoFinishInputSchema>;

/** The start and end of a finished session, corrected. */
/** How far back a corrected start may go, and how long a session may last. */
export const TIMES_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const YEAR_2000 = Date.parse("2000-01-01T00:00:00Z");

/**
 * The start and end of a finished session, corrected: the start within the last year (never
 * before 2000), the end not before it, and at most 24 h apart. «Not after now» is the server's.
 */
export const updateTimesInputSchema = z
  .object({ sessionId, startedAt: instant, endedAt: instant })
  .superRefine((value, context) => {
    const start = Date.parse(value.startedAt);
    const end = Date.parse(value.endedAt);
    if (start < YEAR_2000 || start < Date.now() - TIMES_MAX_AGE_MS) {
      context.addIssue({ code: "custom", message: ERRORS.startTooOld, path: ["startedAt"] });
    }
    if (end < start) {
      context.addIssue({ code: "custom", message: ERRORS.endBeforeStart, path: ["endedAt"] });
    } else if (end - start > SESSION_MAX_MS) {
      context.addIssue({ code: "custom", message: ERRORS.tooLong, path: ["endedAt"] });
    }
  });
export type UpdateTimesInput = z.output<typeof updateTimesInputSchema>;
