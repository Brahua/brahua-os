// The reminder source of `tasks` (SPEC-reminders "Contratos → Con `tasks`"): it has no reminder of
// its own in v1 (a task at its time is a later cut); it gives the morning briefing the tasks that
// fall due that day, from the same summary `today` shows (`selectTasksTodaySummary`, the version
// that trusts its caller because the tick has no session). Only the ones due that very day count:
// the briefing never counts what is overdue (SPEC-reminders: no debt tone). Registered by the
// composition root src/lib/reminder-sources.ts; imports nothing of `reminders` but its contracts.
import "server-only";
import { getDb } from "@/lib/db";
import type { ReminderSource } from "@/modules/reminders/contracts";
import { selectTasksTodaySummary } from "./contracts";

export const tasksReminderSource: ReminderSource = {
  id: "tasks",
  candidates: async () => [],
  async briefingFacts(at) {
    const summary = await selectTasksTodaySummary(getDb(), at);
    return { tasksDueToday: summary.filter((task) => task.due.kind === "today").length };
  },
};
