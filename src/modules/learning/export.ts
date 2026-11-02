// Tables `learning` offers to `pnpm db:export` (src/lib/data-export.ts). Deleted tracks, steps and
// sessions are included on purpose: the export is the owner's history, not a view.
import type { ExportableTable } from "@/lib/data-export";
import { learningSessions, learningSteps, learningTracks } from "./db/schema";

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
  {
    table: learningSessions,
    orderBy: [learningSessions.startedAt, learningSessions.createdAt, learningSessions.id],
  },
];
