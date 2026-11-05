// Validation and client types of the routines and their exercises (E1, SPEC-health "Rutinas").
// Client-safe: the screens run the same schemas first so errors show without a round trip; the
// actions are the authority. Every item write names its routine, and the data layer checks the
// item is really its (routine-items.ts).
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  MAX_ROUTINE_ITEMS,
  MAX_ROUTINES,
  ROUTINE_NAME_MAX_LENGTH,
  TARGET_REPS_MAX,
  TARGET_REPS_MIN,
  TARGET_SECONDS_MAX,
  TARGET_SECONDS_MIN,
  TARGET_SETS_MAX,
  TARGET_SETS_MIN,
  usesReps,
  type Equipment,
  type ExerciseKind,
} from "./health-constants";
import { restSecondsSchema } from "./exercises-input";
import { ROUTINE_ERRORS as ERRORS, ROUTINES_COPY } from "./routines-copy";

/** A routine in the list on /health. */
export type RoutineSummary = {
  id: string;
  name: string;
  /** Contiguous among the live routines (0…n-1). */
  position: number;
  /** Its live exercises. */
  exerciseCount: number;
};

/** A routine for its page, or a deleted one for the list's «Deshacer». */
export type RoutineRef = { id: string; name: string };

/** One exercise of a routine, with what its page shows of the exercise. */
export type RoutineItem = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  kind: ExerciseKind;
  equipment: Equipment;
  perDumbbell: boolean;
  /** The exercise's own rest (used when the item has none). */
  exerciseRestSeconds: number;
  /** Contiguous per routine (0…n-1). */
  position: number;
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
  restSeconds: number | null;
};

const codePoints = (value: string) => [...value].length;

/** The name as stored: like names (NFC, collapsed whitespace, trimmed), 1–60 characters. */
export const routineNameSchema = z
  .string({ error: ERRORS.nameRequired })
  .max(2_000, ERRORS.nameTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.nameRequired)
      .refine((value) => codePoints(value) <= ROUTINE_NAME_MAX_LENGTH, ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible),
  );

const routineId = z.guid({ error: ERRORS.notFound });
const itemId = z.guid({ error: ERRORS.itemNotFound });

/** A set of distinct ids (a reorder): checked against the live set by the data layer. */
const idSet = (max: number) =>
  z
    .array(z.guid({ error: ERRORS.order }), { error: ERRORS.order })
    .min(1, ERRORS.order)
    .max(max, ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, ERRORS.order);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The name «Nueva rutina» gives: the first «Rutina A», «Rutina B»… no live routine has (without
 * case), then «Rutina 27», «Rutina 28»…
 */
export function defaultRoutineName(taken: readonly string[]): string {
  const keys = new Set(taken.map((name) => normalizeName(name).toLowerCase()));
  for (const letter of LETTERS) {
    const name = ROUTINES_COPY.defaultName(letter);
    if (!keys.has(name.toLowerCase())) return name;
  }
  for (let n = LETTERS.length + 1; ; n++) {
    const name = ROUTINES_COPY.defaultName(String(n));
    if (!keys.has(name.toLowerCase())) return name;
  }
}

/** «Nueva rutina»: no fields (it gets the next free «Rutina A/B/C…» name; renamed in place). */
export const createRoutineInputSchema = z.object({});
export const renameRoutineInputSchema = z.object({ id: routineId, name: routineNameSchema });
export type RenameRoutineInput = z.output<typeof renameRoutineInputSchema>;
export const routineIdInputSchema = z.object({ id: routineId });
export const reorderRoutinesInputSchema = z.object({ ids: idSet(MAX_ROUTINES) });

// ── A routine's exercises ─────────────────────────────────────────────────────────────────

const int = (message: string, min: number, max: number) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

/**
 * An item's targets. Which of reps or seconds it carries depends on its exercise's kind
 * (`targetsProblem`, checked by the data layer that reads the kind); the pair rules are here.
 */
const targetsShape = {
  targetSets: int(ERRORS.sets, TARGET_SETS_MIN, TARGET_SETS_MAX),
  repsMin: int(ERRORS.reps, TARGET_REPS_MIN, TARGET_REPS_MAX).nullable(),
  repsMax: int(ERRORS.reps, TARGET_REPS_MIN, TARGET_REPS_MAX).nullable(),
  targetSeconds: int(ERRORS.seconds, TARGET_SECONDS_MIN, TARGET_SECONDS_MAX).nullable(),
  restSeconds: restSecondsSchema.nullable(),
};

type TargetsInput = {
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
  restSeconds: number | null;
};

/** The pair rules: reps come together and min ≤ max (on `repsMax`, where the form shows it). */
function checkPairs(value: TargetsInput, context: z.RefinementCtx) {
  if ((value.repsMin === null) !== (value.repsMax === null)) {
    context.addIssue({
      code: "custom",
      message: ERRORS.reps,
      path: [value.repsMin === null ? "repsMin" : "repsMax"],
    });
  } else if (value.repsMin !== null && value.repsMax !== null && value.repsMin > value.repsMax) {
    context.addIssue({ code: "custom", message: ERRORS.repsOrder, path: ["repsMax"] });
  }
}

export type TargetField = "targetSets" | "repsMin" | "repsMax" | "targetSeconds" | "restSeconds";

/**
 * What the exercise's kind asks that `targets` doesn't give, as the field to mark: reps for
 * weight_reps/reps (and no seconds), seconds for time/cardio (and no reps). Null when they fit.
 */
export function targetsProblem(
  kind: ExerciseKind,
  targets: Pick<TargetsInput, "repsMin" | "repsMax" | "targetSeconds">,
): TargetField | null {
  if (usesReps(kind)) {
    if (targets.repsMin === null) return "repsMin";
    if (targets.repsMax === null) return "repsMax";
    return targets.targetSeconds === null ? null : "targetSeconds";
  }
  if (targets.targetSeconds === null) return "targetSeconds";
  return targets.repsMin === null && targets.repsMax === null ? null : "repsMin";
}

/**
 * Add one exercise at the end. The id comes from the client (a random uuid), so the row on screen
 * can be edited or moved before the server answers: those calls queue behind this one.
 */
export const addItemInputSchema = z
  .object({
    routineId,
    id: itemId,
    exerciseId: z.guid({ error: ERRORS.exerciseUnavailable }),
    ...targetsShape,
  })
  .superRefine(checkPairs);
export type AddItemInput = z.output<typeof addItemInputSchema>;

/** Its targets, sent whole. */
export const updateItemInputSchema = z
  .object({ routineId, id: itemId, ...targetsShape })
  .superRefine(checkPairs);
export type UpdateItemInput = z.output<typeof updateItemInputSchema>;

/** Remove (a soft delete). */
export const itemRefInputSchema = z.object({ routineId, id: itemId });
export type ItemRefInput = z.output<typeof itemRefInputSchema>;

/** «Deshacer» of a remove: the same item back, after the neighbour it had (else at `position`). */
export const restoreItemInputSchema = z.object({
  routineId,
  id: itemId,
  afterId: z.guid({ error: ERRORS.order }).nullable().default(null),
  position: int(ERRORS.order, 0, MAX_ROUTINE_ITEMS),
});
export type RestoreItemInput = z.output<typeof restoreItemInputSchema>;

/** Every live item id of the routine in the new order (checked as a set against the routine's). */
export const reorderItemsInputSchema = z.object({ routineId, ids: idSet(MAX_ROUTINE_ITEMS) });
export type ReorderItemsInput = z.output<typeof reorderItemsInputSchema>;

// ── The item form ────────────────────────────────────────────────────────────────────────

/** What the item's form holds: text as typed (a cardio's time in minutes), and the rest. */
export type TargetsForm = {
  targetSets: string;
  repsMin: string;
  repsMax: string;
  /** Seconds for `time`, minutes for `cardio`. */
  duration: string;
  /** "" = the exercise's. */
  restSeconds: string;
};

/** A whole positive number as typed, or null (empty, or not a whole number). */
function whole(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

export function targetsToForm(kind: ExerciseKind, item: TargetsInput): TargetsForm {
  const duration =
    item.targetSeconds === null
      ? ""
      : kind === "cardio"
        ? String(Math.round(item.targetSeconds / 60))
        : String(item.targetSeconds);
  return {
    targetSets: String(item.targetSets),
    repsMin: item.repsMin === null ? "" : String(item.repsMin),
    repsMax: item.repsMax === null ? "" : String(item.repsMax),
    duration,
    restSeconds: item.restSeconds === null ? "" : String(item.restSeconds),
  };
}

/**
 * The form as targets for `kind`, or the first field with a problem and its message (the field
 * of the duration is `targetSeconds`). The schema still runs on the result.
 */
export function formToTargets(
  kind: ExerciseKind,
  form: TargetsForm,
):
  | { ok: true; targets: TargetsInput }
  | { ok: false; errors: Partial<Record<TargetField, string>> } {
  const errors: Partial<Record<TargetField, string>> = {};
  const targetSets = whole(form.targetSets);
  if (targetSets === null) errors.targetSets = ERRORS.sets;
  let repsMin: number | null = null;
  let repsMax: number | null = null;
  let targetSeconds: number | null = null;
  if (usesReps(kind)) {
    repsMin = whole(form.repsMin);
    // An empty maximum is the minimum (one number).
    repsMax = form.repsMax.trim() === "" ? repsMin : whole(form.repsMax);
    if (repsMin === null) errors.repsMin = ERRORS.reps;
    if (repsMax === null) errors.repsMax = ERRORS.reps;
  } else {
    const duration = whole(form.duration);
    if (duration === null || duration === 0) {
      errors.targetSeconds = kind === "cardio" ? ERRORS.minutes : ERRORS.seconds;
    } else {
      targetSeconds = kind === "cardio" ? duration * 60 : duration;
    }
  }
  const restSeconds = form.restSeconds === "" ? null : whole(form.restSeconds);
  if (form.restSeconds !== "" && restSeconds === null) errors.restSeconds = ERRORS.rest;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const targets = { targetSets: targetSets!, repsMin, repsMax, targetSeconds, restSeconds };
  const parsed = z.object(targetsShape).superRefine(checkPairs).safeParse(targets);
  if (parsed.success) return { ok: true, targets: parsed.data };
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as TargetField;
    errors[field] ??=
      field === "targetSeconds" && kind === "cardio" ? ERRORS.minutes : issue.message;
  }
  return { ok: false, errors };
}
