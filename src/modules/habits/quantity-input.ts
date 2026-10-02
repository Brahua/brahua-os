// Validation of H3's writes of a quantity habit's day (logging with a tap, "Ajustar el día").
// Client-safe: the adjust sheet runs the same schema first. A new goal is part of an edit
// (`updateHabitInputSchema`, measure-input.ts's `measureUpdateShape`).
import { z } from "zod";
import { HABIT_GOAL_MAX, HABIT_QUANTITY_MAX } from "./habit-constants";
import { HABIT_ERRORS } from "./habit-input";
import { MEASURE_ERRORS } from "./measure-copy";

const id = z.uuid({ error: HABIT_ERRORS.notFound });
const day = z.iso.date({ error: HABIT_ERRORS.dayInvalid });

/**
 * One tap of a quantity habit: adds `delta` (the step; its "Deshacer" sends minus the step) to
 * the day. Not zero, and no bigger than a step can be (the goal's maximum).
 */
export const logHabitInputSchema = z.object({
  id,
  day,
  delta: z
    .number({ error: MEASURE_ERRORS.deltaInvalid })
    .int(MEASURE_ERRORS.deltaInvalid)
    .min(-HABIT_GOAL_MAX, MEASURE_ERRORS.deltaInvalid)
    .max(HABIT_GOAL_MAX, MEASURE_ERRORS.deltaInvalid)
    .refine((value) => value !== 0, MEASURE_ERRORS.deltaInvalid),
});

export type LogHabitInput = z.output<typeof logHabitInputSchema>;

/** A day's exact quantity ("Ajustar el día"): 0–99 999. */
export const quantitySchema = z
  .number({ error: MEASURE_ERRORS.quantityInvalid })
  .int(MEASURE_ERRORS.quantityInvalid)
  .min(0, MEASURE_ERRORS.quantityInvalid)
  .max(HABIT_QUANTITY_MAX, MEASURE_ERRORS.quantityInvalid);

export const setHabitQuantityInputSchema = z.object({ id, day, quantity: quantitySchema });

export type SetHabitQuantityInput = z.output<typeof setHabitQuantityInputSchema>;
