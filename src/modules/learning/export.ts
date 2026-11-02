// Tables `learning` offers to `pnpm db:export` (src/lib/data-export.ts). Deleted tracks and steps
// are included on purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { learningSteps, learningTracks } from "./db/schema";

export const learningExportTables: ExportableTable[] = [
  { table: learningTracks, orderBy: [learningTracks.createdAt, learningTracks.id] },
  {
    table: learningSteps,
    orderBy: [
      learningSteps.trackId,
      learningSteps.position,
      learningSteps.createdAt,
      learningSteps.id,
    ],
  },
];
