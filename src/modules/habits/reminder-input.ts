// R4: a habit's optional reminder time ("Hora del aviso", Lima, `HH:MM`) and part of the day
// ("Franja"). Client-safe. Its own file, like details-input.ts: `createHabitInputSchema` spreads
// `reminderInputShape` and the edit schema `reminderUpdateShape`.
//
// Semantics: creating, blank or missing is "none". Editing, missing leaves the value as it is and
// "" or null clears it (the form sends only what changed). A habit to avoid has no time (there is
// nothing to do "now"): creating, `refineReminder` rejects it; editing, the kind is not in the
// input, so `updateHabitById` checks it under the habit's row lock (the database CHECK is the
// last wall). A part of the day is fine for any habit.
import { z } from "zod";
import { HABIT_DAYPARTS, type HabitDaypart } from "./habit-constants";
import { REMINDER_ERRORS } from "./reminder-copy";

/** `HH:MM`, 24 h, no seconds (the column is `time` and a CHECK rejects seconds). */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const reminderTime = z
  .string({ error: REMINDER_ERRORS.timeInvalid })
  .regex(TIME, REMINDER_ERRORS.timeInvalid);
const daypart = z.enum(HABIT_DAYPARTS, { error: REMINDER_ERRORS.daypartInvalid });

/**
 * What the form sends for a time left half-edited (one segment of the native input emptied: the
 * input says `value === ""` with `validity.badInput`). It matches no time, so validation refuses
 * it on the field («Escribe una hora válida…») instead of silently keeping the previous time.
 */
export const INCOMPLETE_TIME = "--:--";

/** "" or null: not given (the form sends "" for an empty field). */
const blankIsMissing = (value: unknown) => (value === "" || value === null ? undefined : value);
/** "" is null: clears the value. Missing stays missing. */
const blankIsNull = (value: unknown) => (value === "" ? null : value);

export const reminderInputShape = {
  reminderTime: z.preprocess(blankIsMissing, reminderTime.optional()),
  daypart: z.preprocess(blankIsMissing, daypart.optional()),
};

export const reminderUpdateShape = {
  reminderTime: z.preprocess(blankIsNull, reminderTime.nullable().optional()),
  daypart: z.preprocess(blankIsNull, daypart.nullable().optional()),
};

/** The fields of the reminder block, in the form's order (focus goes to the first invalid one). */
export const REMINDER_FIELDS = ["reminderTime", "daypart"] as const;
export type ReminderField = (typeof REMINDER_FIELDS)[number];

/** Creating: a habit to avoid takes no time. */
export function refineReminder(input: object, ctx: z.RefinementCtx): void {
  const data = input as { kind?: string; reminderTime?: string };
  if (data.kind === "avoid" && data.reminderTime !== undefined) {
    ctx.addIssue({ code: "custom", path: ["reminderTime"], message: REMINDER_ERRORS.timeAvoid });
  }
}

/** The columns `insertHabit` stores. */
export function reminderColumns(input: { reminderTime?: string; daypart?: HabitDaypart }) {
  return { reminderTime: input.reminderTime ?? null, daypart: input.daypart ?? null };
}

/** The columns `updateHabitById` changes (only the ones sent; null clears). */
export function reminderUpdateColumns(input: {
  reminderTime?: string | null;
  daypart?: HabitDaypart | null;
}) {
  return {
    ...(input.reminderTime !== undefined ? { reminderTime: input.reminderTime } : {}),
    ...(input.daypart !== undefined ? { daypart: input.daypart } : {}),
  };
}
