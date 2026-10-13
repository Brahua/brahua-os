// Tables `goals` offers to `pnpm db:export` (src/lib/data-export.ts). Archived and deleted goals
// and their entries are included on purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { goalEntries, goals, weeklyObjectives } from "./db/schema";

export const goalsExportTables: ExportableTable[] = [
  { table: goals, orderBy: [goals.createdAt, goals.id] },
  { table: goalEntries, orderBy: [goalEntries.goalId, goalEntries.createdAt, goalEntries.id] },
  { table: weeklyObjectives, orderBy: [weeklyObjectives.weekStart] },
];
