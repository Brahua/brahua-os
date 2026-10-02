"use server";

// Logging a day (SPEC-habits "Registrar"), with ownerAction() like every action. `today` (H6) can
// import these too: they don't depend on the habits screen. H3 adds `logHabit` (a quantity
// delta) here.
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import { setHabitDoneInputSchema, type HabitItem } from "./habit-input";
import { setHabitDoneById } from "./habits";
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
 * its start date. The state wanted, not a toggle, so it is idempotent. Returns the habit as it is
 * on that day.
 */
export async function setHabitDone(input: unknown): Promise<ActionResult<HabitItem>> {
  return setDone(input);
}
