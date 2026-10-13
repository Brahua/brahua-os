// Tables `weekly-review` offers to `pnpm db:export` (src/lib/data-export.ts): the closed weeks
// with their notes, the owner's history.
import type { ExportableTable } from "@/lib/data-export";
import { weeklyReviews } from "./db/schema";

export const weeklyReviewExportTables: ExportableTable[] = [
  { table: weeklyReviews, orderBy: [weeklyReviews.weekStart] },
];
