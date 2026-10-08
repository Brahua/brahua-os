// The source of the morning briefing (SPEC-reminders "Avisos"). It lives in `reminders`, not in a
// module, because one message spans all of them: the habits, the tasks and the payments of the
// day. Each module's source offers `briefingFacts(at)` (contracts.ts); this one merges them and
// writes the sentence (messages.ts). `reminders` still imports no module: it only reads the
// sources registered in the registry.
//
// dedupe key `briefing:<day>`. The window of a briefing can cross midnight (a briefing at 23:30 is
// still open at 00:30), so yesterday's candidate is offered too while its window is open.
import "server-only";
import { listReminderSources, type ReminderSource } from "./contracts";
import { briefingText, type BriefingFacts, type PaymentFact } from "./messages";
import { briefingSlot, windowState } from "./slots";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The facts of every registered source merged into one: counts add up, payments concatenate. */
export async function collectBriefingFacts(
  sources: readonly ReminderSource[],
  at: Date,
): Promise<BriefingFacts> {
  const all = await Promise.all(
    sources.map(
      (source): Promise<BriefingFacts> => source.briefingFacts?.(at) ?? Promise.resolve({}),
    ),
  );
  const payments: PaymentFact[] = [];
  let habitsToday = 0;
  let tasksDueToday = 0;
  for (const facts of all) {
    habitsToday += facts.habitsToday ?? 0;
    tasksDueToday += facts.tasksDueToday ?? 0;
    payments.push(...(facts.paymentsDueToday ?? []));
  }
  return { habitsToday, tasksDueToday, paymentsDueToday: payments };
}

/** `sources` is injectable for tests; production reads the registry when the briefing is built. */
export function createBriefingSource(
  sources: () => readonly ReminderSource[] = listReminderSources,
): ReminderSource {
  return {
    id: "briefing",
    async candidates(ctx) {
      const days = [ctx.today];
      // Yesterday's, only while its window is still open (a late briefing is not worth recording).
      const yesterdaySlot = briefingSlot(ctx.yesterday, ctx.times.briefing);
      if (windowState(yesterdaySlot, ctx.now) === "open") days.unshift(ctx.yesterday);
      return days.map((day) => ({
        kind: "briefing" as const,
        dedupeKey: `briefing:${day}`,
        dueAt: briefingSlot(day, ctx.times.briefing),
        build: async ({ showAmounts }) => {
          // An instant inside that day: now, or the same wall-clock time one day earlier.
          const at = day === ctx.today ? ctx.now : new Date(ctx.now.getTime() - DAY_MS);
          return briefingText(await collectBriefingFacts(sources(), at), showAmounts);
        },
      }));
    },
  };
}

export const briefingSource: ReminderSource = createBriefingSource();
