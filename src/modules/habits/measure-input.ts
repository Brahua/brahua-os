// The kind and measure part of creating (and editing) a habit. Client-safe. **Owned by H3**: the
// schema fields, the columns they become and the summary, without touching the files H2 edits
// (frequency-input.ts). The cross rule "a evitar ⇒ sí/no diario" needs both halves: it is
// `refineMeasure`, a superRefine on the whole object (`createHabitInputSchema`), which reads the
// frequency when the schema has it (H2) and takes "daily" otherwise.
import { z } from "zod";
import {
  HABIT_GOAL_MAX,
  HABIT_KINDS,
  HABIT_MEASURES,
  HABIT_UNIT_MAX_LENGTH,
  type HabitKind,
  type HabitMeasure,
} from "./habit-constants";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { MEASURE_COPY, MEASURE_ERRORS } from "./measure-copy";

/** "Varias veces al día": a daily quantity habit counted in "veces", one per tap. */
export const SEVERAL_TIMES_UNIT = "veces";
/** The goal the "Varias veces al día" shortcut starts with (2: morning and night). */
export const SEVERAL_TIMES_DEFAULT_GOAL = 2;

/** A whole number from a form or a call: a number only (the form converts its text first). */
function wholeNumber(errors: { required: string; invalid: string; tooBig: string }, max: number) {
  return z
    .number({ error: (issue) => (issue.input === undefined ? errors.required : errors.invalid) })
    .int(errors.invalid)
    .min(1, errors.invalid)
    .max(max, errors.tooBig);
}

/** A quantity habit's goal: 1–10 000 a day. */
export const goalSchema = wholeNumber(
  {
    required: MEASURE_ERRORS.goalRequired,
    invalid: MEASURE_ERRORS.goalInvalid,
    tooBig: MEASURE_ERRORS.goalTooBig,
  },
  HABIT_GOAL_MAX,
);

/** What a tap adds: 1–goal (checked against the goal by `refineMeasure`). */
export const stepSchema = wholeNumber(
  {
    required: MEASURE_ERRORS.stepInvalid,
    invalid: MEASURE_ERRORS.stepInvalid,
    tooBig: MEASURE_ERRORS.stepTooBig,
  },
  HABIT_GOAL_MAX,
);

/** The unit ("vasos", "min"): 1–20 characters, normalized like names. */
export const unitSchema = z
  .string({ error: MEASURE_ERRORS.unitRequired })
  // A cheap cap before normalizing, like the name's.
  .max(HABIT_UNIT_MAX_LENGTH * 4, MEASURE_ERRORS.unitTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, MEASURE_ERRORS.unitRequired)
      .max(HABIT_UNIT_MAX_LENGTH, MEASURE_ERRORS.unitTooLong)
      .refine((value) => !hasInvisibleCharacters(value), MEASURE_ERRORS.unitInvisible),
  );

/** "", null or missing is "not given" (the form sends "" for an empty field). */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());

/**
 * H3 (Tipo y Medición): `kind` (build by default), `measure` (check by default) and, for a
 * quantity, `goal`, `unit` and `step` (1 by default). A yes/no habit ignores the last three.
 */
export const measureInputShape = {
  kind: z.enum(HABIT_KINDS, { error: MEASURE_ERRORS.kind }).default("build"),
  measure: z.enum(HABIT_MEASURES, { error: MEASURE_ERRORS.measure }).default("check"),
  goal: optional(goalSchema),
  unit: optional(unitSchema),
  step: optional(stepSchema),
};

/** What `refineMeasure` and `measureColumns` read of a parsed input. */
type MeasureFields = {
  kind: HabitKind;
  measure: HabitMeasure;
  goal?: number;
  unit?: string;
  step?: number;
  /** H2's field, when the schema has it (daily otherwise). */
  frequency?: string;
};

/**
 * The rules across fields, as a superRefine of the whole input (so it composes with H2's
 * frequency): a quantity needs its goal and unit and a step up to the goal; a habit to avoid is
 * a yes/no, every day (SPEC-habits "Tipo").
 */
export function refineMeasure(input: object, ctx: z.RefinementCtx): void {
  const data = input as MeasureFields;
  if (data.kind === "avoid") {
    if (data.measure !== "check") {
      ctx.addIssue({ code: "custom", path: ["measure"], message: MEASURE_ERRORS.avoidMeasure });
    }
    if (data.frequency !== undefined && data.frequency !== "daily") {
      ctx.addIssue({ code: "custom", path: ["frequency"], message: MEASURE_ERRORS.avoidDaily });
    }
    return;
  }
  if (data.measure !== "quantity") return;
  refineQuantity(data, ctx);
}

/** A quantity's goal and unit are given and its step is up to the goal. */
function refineQuantity(data: Partial<MeasureFields>, ctx: z.RefinementCtx): void {
  if (data.goal === undefined) {
    ctx.addIssue({ code: "custom", path: ["goal"], message: MEASURE_ERRORS.goalRequired });
  }
  if (data.unit === undefined) {
    ctx.addIssue({ code: "custom", path: ["unit"], message: MEASURE_ERRORS.unitRequired });
  }
  // Zod 4 runs this even when a field failed its own checks: compare only valid ones.
  if (
    goalSchema.safeParse(data.goal).success &&
    stepSchema.safeParse(data.step).success &&
    (data.step as number) > (data.goal as number)
  ) {
    ctx.addIssue({ code: "custom", path: ["step"], message: MEASURE_ERRORS.stepTooBig });
  }
}

/**
 * Editing a habit (`updateHabitInputSchema`): a quantity's new `goal`, `unit` and `step`, all
 * optional (a yes/no sends none). The kind and the measure never change in an edit.
 */
export const measureUpdateShape = {
  goal: optional(goalSchema),
  unit: optional(unitSchema),
  step: optional(stepSchema),
};

/** An edit that sends any of a quantity's fields sends the goal and unit, with a step ≤ goal. */
export function refineMeasureUpdate(input: object, ctx: z.RefinementCtx): void {
  const data = input as Partial<MeasureFields>;
  if (data.goal === undefined && data.unit === undefined && data.step === undefined) return;
  refineQuantity(data, ctx);
}

/**
 * The columns of the kind and measure in a parsed (and refined) input. A yes/no habit is always
 * goal 1, step 1 and no unit (the database CHECK says the same); a habit to avoid is a yes/no.
 */
export function measureColumns(input: object): {
  kind: HabitKind;
  measure: HabitMeasure;
  goal: number;
  unit: string | null;
  step: number;
} {
  const data = input as Partial<MeasureFields>;
  const kind = data.kind ?? "build";
  if (kind === "avoid" || data.measure !== "quantity") {
    return { kind, measure: "check", goal: 1, unit: null, step: 1 };
  }
  return {
    kind,
    measure: "quantity",
    goal: data.goal ?? 1,
    unit: data.unit ?? null,
    step: data.step ?? 1,
  };
}

/** What the form's live summary reads of its draft (raw: the fields may not be valid yet). */
export type MeasureDraft = {
  kind?: string;
  measure?: string;
  goal?: unknown;
  unit?: unknown;
  step?: unknown;
};

/** The measure half of the form's live summary ("Sí o no", "8 vasos", "A evitar"…). */
export function measureSummary(draft: object): string {
  const data = draft as MeasureDraft;
  if (data.kind === "avoid") return MEASURE_COPY.summaryAvoid;
  if (data.measure !== "quantity") return MEASURE_COPY.summaryCheck;
  const goal = goalSchema.safeParse(data.goal);
  const unit = unitSchema.safeParse(data.unit);
  const step = stepSchema.safeParse(data.step);
  return MEASURE_COPY.summaryQuantity(
    goal.success ? goal.data : null,
    unit.success ? unit.data : null,
    step.success && step.data > 1 ? step.data : null,
  );
}
