// Validation of recurrence rules (T3). Client-safe: the editor runs the same schema before the
// server action (the authority), and the database CHECK `tasks_recurrence_check` is the last
// line of defense. The output is the stored shape (`TaskRecurrence`: every field, null when the
// rule doesn't use it), with the weekdays deduplicated and sorted (the CHECK wants them strictly
// ascending).
import { z } from "zod";
import {
  INTERVAL_RECURRENCE_KINDS,
  ISO_WEEKDAYS,
  MONTH_DAY_MAX,
  RECURRENCE_INTERVAL_MAX,
} from "./task-constants";
import type { TaskRecurrence } from "./task-input";
import { RECURRENCE_ERRORS } from "./recurrence-copy";

/** Whole numbers only; numeric strings (a form's value) are accepted. */
const whole = (min: number, max: number, error: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number({ error }).int({ error }).min(min, { error }).max(max, { error }),
  );

const interval = whole(1, RECURRENCE_INTERVAL_MAX, RECURRENCE_ERRORS.interval);

const weekday = z
  .number({ error: RECURRENCE_ERRORS.weekdays })
  .int({ error: RECURRENCE_ERRORS.weekdays })
  .min(ISO_WEEKDAYS[0], { error: RECURRENCE_ERRORS.weekdays })
  .max(ISO_WEEKDAYS[ISO_WEEKDAYS.length - 1], { error: RECURRENCE_ERRORS.weekdays });

const everyRule = z.object({
  kind: z.enum(INTERVAL_RECURRENCE_KINDS),
  interval,
});

const weekdaysRule = z.object({
  kind: z.literal("weekdays"),
  weekdays: z
    .array(weekday, { error: RECURRENCE_ERRORS.weekdays })
    .max(ISO_WEEKDAYS.length * 2, { error: RECURRENCE_ERRORS.weekdays })
    .transform((days) => [...new Set(days)].sort((a, b) => a - b))
    .pipe(z.array(z.number()).min(1, { error: RECURRENCE_ERRORS.weekdays })),
});

const monthDayRule = z.object({
  kind: z.literal("month_day"),
  monthDay: whole(1, MONTH_DAY_MAX, RECURRENCE_ERRORS.monthDay),
});

/**
 * One recurrence rule: `{ kind: "every_days" | "every_weeks" | "every_months", interval }`,
 * `{ kind: "weekdays", weekdays }` or `{ kind: "month_day", monthDay }`. Fields of another rule
 * are ignored (stripped), never stored.
 */
export const recurrenceRuleSchema = z
  .discriminatedUnion("kind", [everyRule, weekdaysRule, monthDayRule], {
    error: RECURRENCE_ERRORS.kind,
  })
  .transform(
    (rule): TaskRecurrence => ({
      kind: rule.kind,
      interval: "interval" in rule ? rule.interval : null,
      weekdays: "weekdays" in rule ? rule.weekdays : null,
      monthDay: "monthDay" in rule ? rule.monthDay : null,
    }),
  );

/** A rule, or null (no recurrence). */
export const optionalRecurrenceSchema = recurrenceRuleSchema.nullable();

/** Sets or removes (null) a task's rule. */
export const setTaskRecurrenceInputSchema = z.object({
  id: z.uuid(),
  recurrence: optionalRecurrenceSchema,
});

export type SetTaskRecurrenceInput = z.output<typeof setTaskRecurrenceInputSchema>;
