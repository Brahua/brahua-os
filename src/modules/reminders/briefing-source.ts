// The source of the morning briefing (SPEC-reminders "Avisos"). It lives in `reminders`, not in a
// module, because one message spans all of them: the habits, the tasks and the payments of the
// day. Each module's source offers `briefingFacts(at)` (contracts.ts); this one merges them and
// writes the sentence (messages.ts). `reminders` still imports no module: it only reads the
// sources registered in the registry.
//
// dedupe key `briefing:<day>`. Only today's briefing is offered: one at 23:30 that was missed is
// not sent at 00:30 (it would talk about "today" with the facts of a new day). `payment_eve` is
// the one that keeps its midnight crossing («Hoy vence …»).
import "server-only";
import { listReminderSources, type ReminderSource } from "./contracts";
import { briefingText, type BriefingFacts, type PaymentFact } from "./messages";
import { briefingSlot } from "./slots";

/**
 * The facts of every registered source merged into one: counts add up, payments concatenate. A
 * source that throws makes the whole collection throw: there is no partial briefing.
 */
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
      return [
        {
          kind: "briefing" as const,
          dedupeKey: `briefing:${ctx.today}`,
          dueAt: briefingSlot(ctx.today, ctx.times.briefing),
          build: async ({ showAmounts }) =>
            briefingText(await collectBriefingFacts(sources(), ctx.now), showAmounts),
        },
      ];
    },
  };
}

export const briefingSource: ReminderSource = createBriefingSource();
