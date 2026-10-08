// The reminder source of `habits` (SPEC-reminders "Avisos" y "Contratos → Con `habits`").
// Registered by the composition root src/lib/reminder-sources.ts (imported by name there);
// `reminders` never imports it and this file imports nothing of `reminders` but its contracts.
//
// - `evening_review`: at the owner's evening time, only if some habit due today is not met yet:
//   «Te queda Leer. Si lo haces ahora, cuenta hoy.». dedupe key `evening:<day>`.
// - `habit_time` (R4): at a habit's own `reminder_time`: «Es hora de Leer.». dedupe key
//   `habit:<habitId>:<day>`. Only if the habit is due that day, started, active, not paused and not
//   met (`selectTimedHabitsLeft`). The owner's `habit_times_enabled` switch is checked by the
//   engine (and by `ctx.enabled`, to skip the queries).
// - the briefing's facts: how many habits are due that day and not met yet.
//
// "Habits left" for the evening review are the ones `getHabitsTodaySummary` gives (due today,
// started, active, NOT paused today: its pure rules) that are not met and are not "a evitar" (a
// habit to avoid is met while there is no relapse: there is nothing to do "now"). Only today's
// review is offered: one at 23:30 that was missed is not sent at 00:30 (it would say "cuenta hoy"
// about a day that is over).
//
// `habit_time` DOES cross midnight (SPEC-reminders "Cruce de medianoche"), but only while its own
// window is open: a habit at 23:30 is offered for the day that ended until 01:30, because
// «Es hora de Leer.» is still true then (its time has come and it is not done, and a day can be
// logged back for a week). Past the window nothing is offered for yesterday: no query is made.
//
// Habits that share the very same minute come in ONE message («Es hora de Leer y Meditar.»), so two
// habits never buzz the phone twice. Their keys stay one per habit, as the spec says: the first
// habit of the group (the manual order) carries the sentence for all, the others build nothing and
// are recorded as skipped (`empty`), which also claims their key for the day. The group is fixed
// when the candidates are listed, so two ticks agree on who speaks.
import "server-only";
import { getDb } from "@/lib/db";
import {
  eveningReviewSlot,
  eveningReviewText,
  habitTimeSlot,
  habitTimeText,
  limaInstant,
  windowState,
  type ReminderCandidate,
  type ReminderSource,
} from "@/modules/reminders/contracts";
import { selectHabitsTodaySummary, selectTimedHabitsLeft, type TimedHabit } from "./contracts";

/** The habits of the day of `at` that are still to do, in the owner's order. */
async function habitsLeft(at: Date) {
  const summary = await selectHabitsTodaySummary(getDb(), at);
  return summary.filter((habit) => habit.kind === "build" && !habit.done);
}

/**
 * The `habit_time` candidates of one Lima day from its timed habits still to do (pure, so the
 * grouping and the keys are tested with a fixed clock). `habits` keep the manual order.
 */
export function habitTimeCandidates(
  day: string,
  habits: readonly TimedHabit[],
): ReminderCandidate[] {
  const byTime = new Map<string, TimedHabit[]>();
  for (const habit of habits) {
    const time = habit.reminderTime.slice(0, 5);
    byTime.set(time, [...(byTime.get(time) ?? []), habit]);
  }
  return habits.map((habit) => {
    const group = byTime.get(habit.reminderTime.slice(0, 5)) ?? [habit];
    const leader = group[0].id === habit.id;
    return {
      kind: "habit_time" as const,
      dedupeKey: `habit:${habit.id}:${day}`,
      dueAt: habitTimeSlot(day, habit.reminderTime.slice(0, 5)),
      // The followers say nothing: the leader's sentence names them.
      build: async () => (leader ? habitTimeText(group.map((member) => member.name)) : null),
    };
  });
}

export const habitsReminderSource: ReminderSource = {
  id: "habits",

  async candidates(ctx) {
    const candidates: ReminderCandidate[] = [
      {
        kind: "evening_review" as const,
        dedupeKey: `evening:${ctx.today}`,
        dueAt: eveningReviewSlot(ctx.today, ctx.times.evening),
        build: async () =>
          eveningReviewText((await habitsLeft(ctx.now)).map((habit) => habit.name)),
      },
    ];
    if (!ctx.enabled.habit_time) return candidates;

    // Yesterday only while the latest possible time (23:59) still has its window open.
    if (windowState(limaInstant(ctx.yesterday, "23:59"), ctx.now) !== "expired") {
      // Noon of yesterday: any instant of that Lima day reads that day.
      const yesterdayHabits = await selectTimedHabitsLeft(
        getDb(),
        limaInstant(ctx.yesterday, "12:00"),
      );
      candidates.push(...habitTimeCandidates(ctx.yesterday, yesterdayHabits));
    }
    candidates.push(
      ...habitTimeCandidates(ctx.today, await selectTimedHabitsLeft(getDb(), ctx.now)),
    );
    return candidates;
  },

  async briefingFacts(at) {
    return { habitsToday: (await habitsLeft(at)).length };
  },
};
