// Tables `household` offers to `pnpm db:export` (src/lib/data-export.ts): the products of the
// shopping list and the recipes, forgotten ones included.
import type { ExportableTable } from "@/lib/data-export";
import { householdProducts, householdRecipes } from "./db/schema";

export const householdExportTables: ExportableTable[] = [
  { table: householdProducts, orderBy: [householdProducts.createdAt, householdProducts.id] },
  { table: householdRecipes, orderBy: [householdRecipes.createdAt, householdRecipes.id] },
];
