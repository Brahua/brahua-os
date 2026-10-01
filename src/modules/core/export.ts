// Tables `core` offers to `pnpm db:export` (src/lib/data-export.ts). Archived areas included.
import type { ExportableTable } from "@/lib/data-export";
import { lifeAreas } from "./db/schema";

export const coreExportTables: ExportableTable[] = [
  { table: lifeAreas, orderBy: [lifeAreas.sortOrder, lifeAreas.id] },
];
