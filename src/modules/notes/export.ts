// Tables `notes` offers to `pnpm db:export` (src/lib/data-export.ts). Deleted notes are included on
// purpose: the export is the owner's history, not a view. N4's generated `search` column is left
// out: it is not in the Drizzle table (only in migration 0028) and is derived from the title and
// the body (tests/integration/notes-search.test.ts checks it).
import type { ExportableTable } from "@/lib/data-export";
import { notes } from "./db/schema";

export const notesExportTables: ExportableTable[] = [
  { table: notes, orderBy: [notes.createdAt, notes.id] },
];
