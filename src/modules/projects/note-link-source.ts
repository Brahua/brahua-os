// What `projects` offers the `[[` links of the notes (SPEC-notes "Fuentes de enlace"): plain data
// functions that never import `notes`. The composition root src/lib/note-link-sources.ts names them
// in the `NoteLinkSource` contract (declared by `notes`); the caller checked the owner.
import "server-only";
import { asc, inArray, isNull, and, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { nameContains, prefixRank } from "@/lib/link-search";
import { projects } from "./db/schema";
import { PROJECT_STATUS_LABELS } from "./projects-copy";
import { projectPath } from "./routes";

const CLOSED = sql`${projects.status} in ('done', 'canceled')`;

/** Live projects whose name contains `q` (no accents or case): open ones first, then prefixes. */
export async function searchProjectLinkTargets(db: Database, q: string, limit: number) {
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(and(isNull(projects.deletedAt), nameContains(projects.name, q)))
    .orderBy(sql`${CLOSED}`, prefixRank(projects.name, q), asc(projects.name), asc(projects.id))
    .limit(limit);
  return rows.map(({ id, name, status }) => ({
    id,
    name,
    hint: status === "done" || status === "canceled" ? PROJECT_STATUS_LABELS[status] : null,
  }));
}

/** The projects behind `ids` (deleted ones too, marked), with their current name and page. */
export async function resolveProjectLinkTargets(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: projects.id, name: projects.name, deletedAt: projects.deletedAt })
    .from(projects)
    .where(inArray(projects.id, [...ids]));
  return rows.map(({ id, name, deletedAt }) => ({
    id,
    name,
    href: projectPath(id),
    deleted: deletedAt !== null,
  }));
}
