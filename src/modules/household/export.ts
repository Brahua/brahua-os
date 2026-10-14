// Tables `household` offers to `pnpm db:export` (src/lib/data-export.ts): the products of the
// shopping list, forgotten ones included.
import type { ExportableTable } from "@/lib/data-export";
import { householdProducts } from "./db/schema";

export const householdExportTables: ExportableTable[] = [
  { table: householdProducts, orderBy: [householdProducts.createdAt, householdProducts.id] },
];
