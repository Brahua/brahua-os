// What `goals` offers the `[[` links of the notes (SPEC-notes "Fuentes de enlace"): plain data
// functions that never import `notes`. The composition root src/lib/note-link-sources.ts names them
// in the `NoteLinkSource` contract (declared by `notes`); the caller checked the owner.
import "server-only";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { nameContains, prefixRank } from "@/lib/link-search";
import { goals } from "./db/schema";
import { goalPath } from "./routes";

/** Shown next to a goal that isn't active in the picker. */
const HINTS = { active: null, achieved: "Lograda", archived: "Archivada" } as const;

/** Live goals whose title contains `q` (no accents or case): active ones first. */
export async function searchGoalLinkTargets(db: Database, q: string, limit: number) {
  const rows = await db
    .select({ id: goals.id, name: goals.title, status: goals.status })
    .from(goals)
    .where(and(isNull(goals.deletedAt), nameContains(goals.title, q)))
    .orderBy(
      sql`${goals.status} <> 'active'`,
      prefixRank(goals.title, q),
      asc(goals.title),
      asc(goals.id),
    )
    .limit(limit);
  return rows.map(({ id, name, status }) => ({ id, name, hint: HINTS[status] }));
}

/** The goals behind `ids` (deleted ones too, marked), with their current title and page. */
export async function resolveGoalLinkTargets(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: goals.id, name: goals.title, deletedAt: goals.deletedAt })
    .from(goals)
    .where(inArray(goals.id, [...ids]));
  return rows.map(({ id, name, deletedAt }) => ({
    id,
    name,
    href: goalPath(id),
    deleted: deletedAt !== null,
  }));
}
