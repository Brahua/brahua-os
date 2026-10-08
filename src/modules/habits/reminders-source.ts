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
// there is no relapse: there is nothing to do "now"). Only today's review is offered: one at 23:30
// that was missed is not sent at 00:30 (it would say "cuenta hoy" about a day that is over).
import "server-only";
import { getDb } from "@/lib/db";
import {
  eveningReviewSlot,
  eveningReviewText,
  type ReminderSource,
} from "@/modules/reminders/contracts";
import { selectHabitsTodaySummary } from "./contracts";

/** The habits of the day of `at` that are still to do, in the owner's order. */
async function habitsLeft(at: Date) {
  const summary = await selectHabitsTodaySummary(getDb(), at);
  return summary.filter((habit) => habit.kind === "build" && !habit.done);
}

export const habitsReminderSource: ReminderSource = {
  id: "habits",

  async candidates(ctx) {
    return [
      {
        kind: "evening_review" as const,
        dedupeKey: `evening:${ctx.today}`,
        dueAt: eveningReviewSlot(ctx.today, ctx.times.evening),
        build: async () =>
          eveningReviewText((await habitsLeft(ctx.now)).map((habit) => habit.name)),
      },
    ];
  },

  async briefingFacts(at) {
    return { habitsToday: (await habitsLeft(at)).length };
  },
};
