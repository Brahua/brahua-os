// What `tasks` offers the `[[` links of the notes (SPEC-notes "Fuentes de enlace"): plain data
// functions that never import `notes`. The composition root src/lib/note-link-sources.ts names them
// in the `NoteLinkSource` contract (declared by `notes`); the caller checked the owner. `done` is
// for N3's live checkbox. Visibility is `visibleTask` (SPEC-tasks "Borrar"): a task of a deleted
// project is hidden from the picker and resolves as gone, like a deleted task.
import "server-only";
import { and, asc, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { nameContains, prefixRank } from "@/lib/link-search";
import { tasks } from "./db/schema";
import { taskPath } from "./routes";
import { visibleTask } from "./tasks";

/** Shown next to a done task in the picker. */
const DONE_HINT = "Hecha";

/** Visible tasks whose title contains `q` (no accents or case): pending ones before done ones. */
export async function searchTaskLinkTargets(db: Database, q: string, limit: number) {
  const rows = await db
    .select({ id: tasks.id, name: tasks.title, doneAt: tasks.doneAt })
    .from(tasks)
    .where(and(visibleTask, nameContains(tasks.title, q)))
    .orderBy(
      sql`${tasks.doneAt} is not null`,
      prefixRank(tasks.title, q),
      asc(tasks.title),
      asc(tasks.id),
    )
    .limit(limit);
  return rows.map(({ id, name, doneAt }) => ({ id, name, hint: doneAt ? DONE_HINT : null }));
}

/** The tasks behind `ids` (hidden ones too, marked deleted), with their title, page and state. */
export async function resolveTaskLinkTargets(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: tasks.id,
      name: tasks.title,
      doneAt: tasks.doneAt,
      visible: sql<boolean>`${visibleTask}`,
    })
    .from(tasks)
    .where(inArray(tasks.id, [...ids]));
  return rows.map(({ id, name, doneAt, visible }) => ({
    id,
    name,
    href: taskPath(id),
    deleted: !visible,
    done: doneAt !== null,
  }));
}
