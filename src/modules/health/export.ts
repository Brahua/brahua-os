// Tables `health` offers to `pnpm db:export` (src/lib/data-export.ts). Deleted rows are included on
// purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import {
  healthExercises,
  healthRoutineExercises,
  healthRoutines,
  healthSettings,
} from "./db/schema";

export const healthExportTables: ExportableTable[] = [
  {
    table: healthExercises,
    orderBy: [healthExercises.createdAt, healthExercises.nameKey, healthExercises.id],
  },
  { table: healthRoutines, orderBy: [healthRoutines.createdAt, healthRoutines.id] },
  {
    table: healthRoutineExercises,
    orderBy: [
      healthRoutineExercises.routineId,
      healthRoutineExercises.position,
      healthRoutineExercises.createdAt,
      healthRoutineExercises.id,
    ],
  },
  { table: healthSettings, orderBy: [healthSettings.id] },
];
