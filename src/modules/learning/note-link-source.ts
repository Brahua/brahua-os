// What `learning` offers the `[[` links of the notes (SPEC-notes "Fuentes de enlace"): plain data
// functions that never import `notes`. The composition root src/lib/note-link-sources.ts names them
// in the `NoteLinkSource` contract (declared by `notes`); the caller checked the owner.
import "server-only";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { nameContains, prefixRank } from "@/lib/link-search";
import { learningTracks } from "./db/schema";
import { STATUS_LABELS } from "./learning-copy";
import { trackPath } from "./routes";

/** Live tracks whose title contains `q` (no accents or case): in progress first, done last. */
export async function searchTrackLinkTargets(db: Database, q: string, limit: number) {
  const rows = await db
    .select({ id: learningTracks.id, name: learningTracks.title, status: learningTracks.status })
    .from(learningTracks)
    .where(and(isNull(learningTracks.deletedAt), nameContains(learningTracks.title, q)))
    .orderBy(
      sql`case ${learningTracks.status} when 'active' then 0 when 'waiting' then 1 else 2 end`,
      prefixRank(learningTracks.title, q),
      asc(learningTracks.title),
      asc(learningTracks.id),
    )
    .limit(limit);
  return rows.map(({ id, name, status }) => ({
    id,
    name,
    hint: status === "active" ? null : STATUS_LABELS[status],
  }));
}

/** The tracks behind `ids` (deleted ones too, marked), with their current title and page. */
export async function resolveTrackLinkTargets(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: learningTracks.id,
      name: learningTracks.title,
      deletedAt: learningTracks.deletedAt,
    })
    .from(learningTracks)
    .where(inArray(learningTracks.id, [...ids]));
  return rows.map(({ id, name, deletedAt }) => ({
    id,
    name,
    href: trackPath(id),
    deleted: deletedAt !== null,
  }));
}
