// Tables `habits` offers to `pnpm db:export` (src/lib/data-export.ts). Archived and deleted
// habits, their logs and their pauses are included on purpose: the export is the owner's
// history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { habitLogs, habitPauses, habits } from "./db/schema";

export const habitsExportTables: ExportableTable[] = [
  { table: habits, orderBy: [habits.createdAt, habits.id] },
  { table: habitLogs, orderBy: [habitLogs.habitId, habitLogs.day] },
  { table: habitPauses, orderBy: [habitPauses.habitId, habitPauses.startDate, habitPauses.id] },
];
