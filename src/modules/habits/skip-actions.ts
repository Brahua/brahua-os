"use server";

// "Saltar hoy" (polish): the Server Actions that rest a habit for today and undo it. Each goes
// through ownerAction() (owner first, Zod, an ActionResult); reachable by any POST, so input is
// `unknown`. In a file of their own, like pause-actions.ts.
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import { habitPauseInputSchema, skipHabitInputSchema } from "./pause-input";
import { revalidateHabitScreens } from "./revalidate";
import { skipHabitDay, unskipHabitDay, type SkippedHabit, type UnskippedHabit } from "./skip";

const skip = ownerAction(
  skipHabitInputSchema,
  async (data) => {
    const skipped = await skipHabitDay(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof skipped === "string" ? refused<SkippedHabit>(skipped) : ok(skipped);
  },
  { name: "skipHabitToday" },
);

/**
 * "Saltar hoy": a one-day pause (today, Lima) with the reason "Descanso". Idempotent (`changed:
 * false` if today is already paused). Returns the pause for its exact "Deshacer".
 */
export async function skipHabitToday(input: unknown): Promise<ActionResult<SkippedHabit>> {
  return skip(input);
}

const unskip = ownerAction(
  habitPauseInputSchema,
  async (data) => {
    const result = await unskipHabitDay(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof result === "string" ? refused<UnskippedHabit>(result) : ok(result);
  },
  { name: "undoSkipHabit" },
);

/** The "Deshacer" of "Saltar hoy": removes that pause only while it is still the one-day skip. */
export async function undoSkipHabit(input: unknown): Promise<ActionResult<UnskippedHabit>> {
  return unskip(input);
}
