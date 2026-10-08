// Composition root of the reminder sources (SPEC-reminders "Motor de avisos"): the one place that
// knows which modules contribute reminders, like `progress-sources.ts` for projects. `reminders`
// never imports the providers; `tasks`, `habits` and `finance` import only
// `@/modules/reminders/contracts`.
//
// A source is imported BY NAME here and registered in `ensureReminderSources()`, which the tick
// endpoint calls first. Never a side-effect-only `import "…"`: package.json declares every JS
// module free of side effects ("sideEffects": ["*.css"]), so the bundler drops imports whose
// exports nobody uses.
//
// R2: `financeReminderSource` (payment_eve / payment_followup), `tasksReminderSource` (the tasks
// of the day, for the briefing), `habitsReminderSource` (evening_review and, from R4, habit_time)
// and `briefingSource` (`reminders`' own: the one message that merges every module's
// `briefingFacts`, so it needs the others registered but imports none of them).
import "server-only";
import { financeReminderSource } from "@/modules/finance/reminders-source";
import { habitsReminderSource } from "@/modules/habits/reminders-source";
import { briefingSource } from "@/modules/reminders/briefing-source";
import { registerReminderSource, type ReminderSource } from "@/modules/reminders/contracts";
import { tasksReminderSource } from "@/modules/tasks/reminders-source";

/** Every reminder source of the app. */
export const SOURCES: readonly ReminderSource[] = [
  briefingSource,
  financeReminderSource,
  habitsReminderSource,
  tasksReminderSource,
];

let registered = false;

/** Registers every source once per server instance (registering is idempotent by id anyway). */
export function ensureReminderSources(): void {
  if (registered) return;
  registered = true;
  for (const source of SOURCES) registerReminderSource(source);
}
