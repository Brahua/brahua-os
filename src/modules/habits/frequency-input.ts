// The frequency part of creating and editing a habit (SPEC-habits "Frecuencia"). Client-safe.
// **Owned by H2**, apart from the files H3 edits (measure-input.ts): the schema fields, the rule
// that ties them (each frequency with exactly its own field), the columns they become and the
// form's summary.
import { z } from "zod";
import {
  HABIT_FREQUENCIES,
  HABIT_WEEKDAYS_MAX,
  HABIT_WEEKLY_TARGET_MAX,
  type HabitFrequency,
} from "./habit-constants";
import { FREQUENCY_COPY, FREQUENCY_ERRORS } from "./frequency-copy";

/** The frequency's fields, as the schemas give them (missing: a daily habit). */
export type FrequencyFields = {
  frequency?: HabitFrequency;
  weeklyTarget?: number | null;
  weekdays?: number[] | null;
};

/** Its fields in the form, in order (focus goes to the first invalid one). */
export const FREQUENCY_FIELDS = ["frequency", "weeklyTarget", "weekdays"] as const;

const frequency = z.enum(HABIT_FREQUENCIES, { error: FREQUENCY_ERRORS.frequency });

/** X of "X veces por semana": 1–6 (seven is "Diaria"). */
const weeklyTarget = z
  .number({ error: FREQUENCY_ERRORS.weeklyTarget })
  .int(FREQUENCY_ERRORS.weeklyTarget)
  .min(1, FREQUENCY_ERRORS.weeklyTarget)
  .max(HABIT_WEEKLY_TARGET_MAX, FREQUENCY_ERRORS.weeklyTarget);

/**
 * ISO weekdays (1 = Monday … 7 = Sunday). Stored sorted and without repeats, as the CHECK wants;
 * how many (1–6) is checked with the frequency (`refineFrequency`): only `weekdays` needs them.
 */
const weekdays = z
  .array(
    z
      .number({ error: FREQUENCY_ERRORS.weekdaysInvalid })
      .int(FREQUENCY_ERRORS.weekdaysInvalid)
      .min(1, FREQUENCY_ERRORS.weekdaysInvalid)
      .max(7, FREQUENCY_ERRORS.weekdaysInvalid),
    { error: FREQUENCY_ERRORS.weekdaysInvalid },
  )
  // A cheap bound before the work: never more than the week.
  .max(7, FREQUENCY_ERRORS.weekdaysInvalid)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

/**
 * `frequency`, `weeklyTarget` and `weekdays`, optional (a daily habit by default). The fields of
 * the other frequencies are ignored (the form keeps them while switching), never stored.
 */
export const frequencyInputShape = {
  frequency: frequency.optional(),
  weeklyTarget: weeklyTarget.nullish(),
  weekdays: weekdays.nullish(),
};

/** For editing: the frequency is always sent (never a silent "daily"). */
export const frequencyUpdateShape = { ...frequencyInputShape, frequency };

/**
 * The rule that ties the fields (a superRefine of the create and update schemas): "Por semana"
 * needs X, "Días fijos" needs 1–6 days (the seven are "Diaria"). Each error on its own field.
 */
export function refineFrequency(data: FrequencyFields, ctx: z.RefinementCtx) {
  if (data.frequency === "weekly_count" && data.weeklyTarget == null) {
    ctx.addIssue({
      code: "custom",
      message: FREQUENCY_ERRORS.weeklyTarget,
      path: ["weeklyTarget"],
    });
  }
  if (data.frequency === "weekdays") {
    const count = data.weekdays?.length ?? 0;
    // More than 7 never got here valid: the field already says why (one message, not two).
    if (count === 0 || (count > HABIT_WEEKDAYS_MAX && count <= 7)) {
      ctx.addIssue({
        code: "custom",
        message: count === 0 ? FREQUENCY_ERRORS.weekdaysNone : FREQUENCY_ERRORS.weekdaysAll,
        path: ["weekdays"],
      });
    }
  }
}

/** The columns of the frequency in the (validated) input: exactly its own field, the rest null. */
export function frequencyColumns(input: FrequencyFields): {
  frequency: HabitFrequency;
  weeklyTarget: number | null;
  weekdays: number[] | null;
} {
  switch (input.frequency ?? "daily") {
    case "daily":
      return { frequency: "daily", weeklyTarget: null, weekdays: null };
    case "weekly_count":
      return {
        frequency: "weekly_count",
        weeklyTarget: input.weeklyTarget ?? null,
        weekdays: null,
      };
    case "weekdays":
      return { frequency: "weekdays", weeklyTarget: null, weekdays: input.weekdays ?? null };
  }
}

/**
 * The frequency half of the form's live summary: "Cada día", "3 veces por semana", "Lunes,
 * miércoles y viernes" (or what is still missing).
 */
export function frequencySummary(draft: object): string {
  const { frequency: chosen, weeklyTarget: times, weekdays: days } = draft as FrequencyFields;
  switch (chosen ?? "daily") {
    case "daily":
      return FREQUENCY_COPY.daily;
    case "weekly_count":
      return times ? FREQUENCY_COPY.timesAWeek(times) : FREQUENCY_COPY.pickTimes;
    case "weekdays": {
      const sorted = [...new Set(days ?? [])].sort((a, b) => a - b);
      return sorted.length > 0 ? FREQUENCY_COPY.weekdays(sorted) : FREQUENCY_COPY.pickDays;
    }
  }
}
