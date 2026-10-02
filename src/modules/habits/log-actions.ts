"use server";

// Logging a day (SPEC-habits "Registrar"), with ownerAction() like every action. `today` (H6) can
// import these too: they don't depend on the habits screen. A yes/no day (also a habit to avoid's
// relapse) is `setHabitDone`; a quantity's tap is `logHabit` and its exact amount
// `setHabitQuantity` (H3).
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import { setHabitDoneInputSchema, type HabitItem } from "./habit-input";
import { setHabitDoneById } from "./habits";
import { logHabitDelta, setHabitQuantityById } from "./quantity";
import { logHabitInputSchema, setHabitQuantityInputSchema } from "./quantity-input";
import { revalidateHabitScreens } from "./revalidate";

const setDone = ownerAction(
  setHabitDoneInputSchema,
  async (data) => {
    const habit = await setHabitDoneById(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "setHabitDone" },
);

/**
 * Marks (`done: true`) or unmarks a yes/no habit's day: today or up to 7 days before (Lima), from
 * its start date. The state wanted, not a toggle, so it is idempotent. For a habit to avoid,
 * `done: true` logs the day's relapse (the day is done without one). Returns the habit as it is
 * on that day.
 */
export async function setHabitDone(input: unknown): Promise<ActionResult<HabitItem>> {
  return setDone(input);
}

const logDelta = ownerAction(
  logHabitInputSchema,
  async (data) => {
    const habit = await logHabitDelta(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "logHabit" },
);

/**
 * One tap of a quantity habit: adds `delta` (its step; "Deshacer" sends minus the step) to the
 * day, clamped to 0–99 999. Atomic: two taps at the same time add up. Today or up to 7 days
 * before (Lima), from its start date. Returns the habit as it is on that day.
 */
export async function logHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return logDelta(input);
}

const setQuantity = ownerAction(
  setHabitQuantityInputSchema,
  async (data) => {
    const habit = await setHabitQuantityById(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "setHabitQuantity" },
);

/**
 * "Ajustar el día": a quantity habit's exact amount on a day (0–99 999), in the same window as a
 * tap. Returns the habit as it is on that day.
 */
export async function setHabitQuantity(input: unknown): Promise<ActionResult<HabitItem>> {
  return setQuantity(input);
}
