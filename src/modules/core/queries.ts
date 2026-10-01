// Reads of `core` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectLifeAreas, type LifeAreaSummary } from "./life-areas";

/** Life areas in their order. Archived ones are left out unless asked for. */
export async function listLifeAreas(
  options: { includeArchived?: boolean } = {},
): Promise<LifeAreaSummary[]> {
  await requireOwner();
  return selectLifeAreas(getDb(), options);
}
