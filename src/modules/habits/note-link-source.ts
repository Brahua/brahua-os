// What `habits` offers the `[[` links of the notes (SPEC-notes "Fuentes de enlace"): plain data
// functions that never import `notes`. The composition root src/lib/note-link-sources.ts names them
// in the `NoteLinkSource` contract (declared by `notes`); the caller checked the owner.
import "server-only";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { nameContains, prefixRank } from "@/lib/link-search";
import { habits } from "./db/schema";
import { habitPath } from "./routes";

/** Shown next to an archived habit in the picker. */
const ARCHIVED_HINT = "Archivado";

/** Live habits whose name contains `q` (no accents or case): archived ones last. */
export async function searchHabitLinkTargets(db: Database, q: string, limit: number) {
  const rows = await db
    .select({ id: habits.id, name: habits.name, archivedAt: habits.archivedAt })
    .from(habits)
    .where(and(isNull(habits.deletedAt), nameContains(habits.name, q)))
    .orderBy(
      sql`${habits.archivedAt} is not null`,
      prefixRank(habits.name, q),
      asc(habits.name),
      asc(habits.id),
    )
    .limit(limit);
  return rows.map(({ id, name, archivedAt }) => ({
    id,
    name,
    hint: archivedAt ? ARCHIVED_HINT : null,
  }));
}

/** The habits behind `ids` (deleted ones too, marked), with their current name and page. */
export async function resolveHabitLinkTargets(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: habits.id, name: habits.name, deletedAt: habits.deletedAt })
    .from(habits)
    .where(inArray(habits.id, [...ids]));
  return rows.map(({ id, name, deletedAt }) => ({
    id,
    name,
    href: habitPath(id),
    deleted: deletedAt !== null,
  }));
}
