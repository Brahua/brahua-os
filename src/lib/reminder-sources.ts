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
// R2 adds `financeReminderSource` (payments), `tasksReminderSource` (the day's summary) and
// `habitsReminderSource` (evening review, and `habit_time` in R4) to SOURCES.
import "server-only";
import { registerReminderSource, type ReminderSource } from "@/modules/reminders/contracts";

/** Every module's reminder source. Empty in R1: the engine runs with none. */
export const SOURCES: readonly ReminderSource[] = [];

let registered = false;

/** Registers every source once per server instance (registering is idempotent by id anyway). */
export function ensureReminderSources(): void {
  if (registered) return;
  registered = true;
  for (const source of SOURCES) registerReminderSource(source);
}
