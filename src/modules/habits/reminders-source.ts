// The reminder source of `habits` (SPEC-reminders "Avisos" y "Contratos → Con `habits`").
// Registered by the composition root src/lib/reminder-sources.ts (imported by name there);
// `reminders` never imports it and this file imports nothing of `reminders` but its contracts.
//
// - `evening_review`: at the owner's evening time, only if some habit due today is not met yet:
//   «Te queda Leer. Si lo haces ahora, cuenta hoy.». dedupe key `evening:<day>`.
// - the briefing's facts: how many habits are due that day and not met yet.
//
// "Habits left" are the ones `getHabitsTodaySummary` gives (due today, started, active, NOT paused
// today: its pure rules) that are not met and are not "a evitar" (a habit to avoid is met while
// there is no relapse: there is nothing to do "now"). A window can cross midnight (a review at
// 23:30 is open at 00:30), so yesterday's candidate is offered too while its window is open, and
// its habits are read at the same wall-clock time one day earlier.
import "server-only";
import { getDb } from "@/lib/db";
import {
  eveningReviewSlot,
  eveningReviewText,
  windowState,
  type ReminderSource,
} from "@/modules/reminders/contracts";
import { selectHabitsTodaySummary } from "./contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The names of the habits of the day of `at` that are still to do, in the owner's order. */
async function habitsLeft(at: Date) {
  const summary = await selectHabitsTodaySummary(getDb(), at);
  return summary.filter((habit) => habit.kind === "build" && !habit.done);
}

export const habitsReminderSource: ReminderSource = {
  id: "habits",

  async candidates(ctx) {
    const days = [ctx.today];
    // Yesterday's, only while its window is still open.
    const yesterdaySlot = eveningReviewSlot(ctx.yesterday, ctx.times.evening);
    if (windowState(yesterdaySlot, ctx.now) === "open") days.unshift(ctx.yesterday);
    return days.map((day) => ({
      kind: "evening_review" as const,
      dedupeKey: `evening:${day}`,
      dueAt: eveningReviewSlot(day, ctx.times.evening),
      build: async () => {
        const at = day === ctx.today ? ctx.now : new Date(ctx.now.getTime() - DAY_MS);
        return eveningReviewText((await habitsLeft(at)).map((habit) => habit.name));
      },
    }));
  },

  async briefingFacts(at) {
    return { habitsToday: (await habitsLeft(at)).length };
  },
};
