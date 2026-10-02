// Milestones data access (server only, P3). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
//
// Every write runs in a transaction that takes the project's milestone lock and checks that the
// project exists and isn't deleted, and every statement on a milestone filters by its project as
// well as its id: an id from another project is "not found" (no IDOR across projects).
//
// Deleting is a soft delete, like projects (CLAUDE.md "never hard-delete"; tasks will point at
// milestones): `deleted_at` takes the row out of every view, of the progress and of the order;
// "Deshacer" clears it and puts the row back in its place. `pnpm db:export` keeps deleted rows.
import "server-only";
import { and, asc, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { projectMilestones, projects } from "./db/schema";
import { PROJECTS_ADVISORY_SPACE } from "./projects";
import {
  MAX_MILESTONES_PER_PROJECT,
  type AddMilestoneInput,
  type MilestoneCounts,
  type MilestoneRefInput,
  type ProjectMilestoneItem,
  type RestoreMilestoneInput,
  type SetMilestoneDoneInput,
  type UpdateMilestoneInput,
} from "./milestone-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MILESTONE = {
  id: projectMilestones.id,
  title: projectMilestones.title,
  dueDate: projectMilestones.dueDate,
  doneAt: projectMilestones.doneAt,
  sortOrder: projectMilestones.sortOrder,
};

/** Milestones that aren't deleted. */
const live = isNull(projectMilestones.deletedAt);

/** Why a milestone write did nothing. */
export type MilestoneFailure = "projectNotFound" | "milestoneNotFound";

/** Second key space of `projects` (`PROJECTS_ADVISORY_SPACE` is the dependency graph's). */
export const MILESTONES_ADVISORY_SPACE = PROJECTS_ADVISORY_SPACE + 1;

/**
 * Transaction-scoped lock on one project's milestones: `(MILESTONES_ADVISORY_SPACE,
 * hashtext(projectId))`, apart from every other lock of the app. Serializes the writes that read and then write the order (add,
 * delete, restore, reorder), so `sort_order` stays contiguous and a reorder always checks its
 * list against the set it is about to write.
 *
 * Rule: always the first lock of the transaction, never after a project row lock (a fixed order
 * between advisory and row locks is what keeps two writers from deadlocking).
 */
function lockMilestones(tx: Tx, projectId: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(MILESTONES_ADVISORY_SPACE))}, hashtext(${projectId}))`,
  );
}

/**
 * Locks the project's milestones (first), then checks the project exists and isn't deleted,
 * holding its row FOR SHARE until the end: a project delete running meanwhile waits.
 */
async function openProject(tx: Tx, projectId: string): Promise<boolean> {
  await lockMilestones(tx, projectId);
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .for("share");
  return project !== undefined;
}

/** One live milestone of the project. */
const ofProject = (projectId: string, id: string) =>
  and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, projectId), live);

/** Rewrites the live milestones' `sort_order` as 0…n-1 in their order (only rows that change). */
async function renumber(tx: Tx, projectId: string) {
  await tx.execute(sql`
    update ${projectMilestones} as m
    set sort_order = ranked.position
    from (
      select id, (row_number() over (order by sort_order, id) - 1)::integer as position
      from ${projectMilestones}
      where project_id = ${projectId} and deleted_at is null
    ) as ranked
    where m.id = ranked.id and m.sort_order <> ranked.position
  `);
}

async function liveCount(tx: Tx, projectId: string): Promise<number> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(projectMilestones)
    .where(and(eq(projectMilestones.projectId, projectId), live));
  return total;
}

/** The project's live milestones in order. */
export async function selectMilestones(
  db: Database | Tx,
  projectId: string,
): Promise<ProjectMilestoneItem[]> {
  return db
    .select(MILESTONE)
    .from(projectMilestones)
    .where(and(eq(projectMilestones.projectId, projectId), live))
    .orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.id));
}

/**
 * Done and total live milestones of every project that isn't deleted and has any, in one
 * aggregate query (the list shows them on every card: no query per card).
 */
export async function selectMilestoneCounts(
  db: Database,
): Promise<Record<string, MilestoneCounts>> {
  const rows = await db
    .select({
      projectId: projectMilestones.projectId,
      total: count(),
      done: count(projectMilestones.doneAt),
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(and(isNull(projects.deletedAt), live))
    .groupBy(projectMilestones.projectId);
  return Object.fromEntries(rows.map(({ projectId, done, total }) => [projectId, { done, total }]));
}

/**
 * Done and total live milestones of one project (zeros without any). "Cerrar proyecto" counts
 * the open ones for its text; it never blocks closing.
 */
export async function selectProjectMilestoneCounts(
  db: Database,
  projectId: string,
): Promise<MilestoneCounts> {
  const [row] = await db
    .select({ total: count(), done: count(projectMilestones.doneAt) })
    .from(projectMilestones)
    .where(and(eq(projectMilestones.projectId, projectId), live));
  return { done: row?.done ?? 0, total: row?.total ?? 0 };
}

/**
 * Adds a milestone at the end. `"tooMany"` at the limit (live milestones only); `"idTaken"` when
 * the id already exists (in this or another project, deleted or not: never overwritten).
 */
export async function insertMilestone(
  db: Database,
  { projectId, id, title }: AddMilestoneInput,
): Promise<ProjectMilestoneItem | "projectNotFound" | "tooMany" | "idTaken"> {
  return db.transaction(async (tx) => {
    if (!(await openProject(tx, projectId))) return "projectNotFound";
    const total = await liveCount(tx, projectId);
    if (total >= MAX_MILESTONES_PER_PROJECT) return "tooMany";
    const [milestone] = await tx
      .insert(projectMilestones)
      .values({ id, projectId, title, sortOrder: total })
      .onConflictDoNothing({ target: projectMilestones.id })
      .returning(MILESTONE);
    return milestone ?? "idTaken";
  });
}

/** Writes fields of one of the project's live milestones and returns it as it is now. */
async function updateMilestone(
  db: Database,
  projectId: string,
  id: string,
  values: Pick<PgUpdateSetSource<typeof projectMilestones>, "title" | "dueDate" | "doneAt">,
): Promise<ProjectMilestoneItem | MilestoneFailure> {
  return db.transaction(async (tx) => {
    if (!(await openProject(tx, projectId))) return "projectNotFound";
    const [milestone] = await tx
      .update(projectMilestones)
      .set(values)
      .where(ofProject(projectId, id))
      .returning(MILESTONE);
    return milestone ?? "milestoneNotFound";
  });
}

/** Title and due date together. */
export function setMilestoneDetails(
  db: Database,
  { projectId, id, title, dueDate }: UpdateMilestoneInput,
) {
  return updateMilestone(db, projectId, id, { title, dueDate });
}

/**
 * Checks or unchecks a milestone. Done keeps the first `done_at` (checking twice changes
 * nothing); pending clears it. Decided by the database, so two tabs can't disagree.
 */
export function setMilestoneDone(db: Database, { projectId, id, done }: SetMilestoneDoneInput) {
  return updateMilestone(db, projectId, id, {
    doneAt: done ? sql`coalesce(${projectMilestones.doneAt}, now())` : null,
  });
}

/**
 * Soft-deletes a milestone and closes the gap among the live ones. Returns the row as it was
 * and its position (what "Deshacer" sends back). A deleted one is "not found".
 */
export async function deleteMilestone(
  db: Database,
  { projectId, id }: MilestoneRefInput,
): Promise<{ milestone: ProjectMilestoneItem; position: number } | MilestoneFailure> {
  return db.transaction(async (tx) => {
    if (!(await openProject(tx, projectId))) return "projectNotFound";
    const [milestone] = await tx
      .update(projectMilestones)
      .set({ deletedAt: sql`now()` })
      .where(ofProject(projectId, id))
      .returning(MILESTONE);
    if (!milestone) return "milestoneNotFound";
    await renumber(tx, projectId);
    return { milestone, position: milestone.sortOrder };
  });
}

/**
 * "Deshacer" after a delete: clears `deleted_at` and puts the milestone back right after
 * `afterId` (the live neighbour it had above it) when that one is still there, else at
 * `position` clamped to the live list. Restoring one that is live changes nothing (a second
 * "Deshacer" is not an error). `"milestoneNotFound"` when the id isn't one of this project's.
 */
export async function restoreMilestone(
  db: Database,
  { projectId, id, position, afterId }: RestoreMilestoneInput,
): Promise<ProjectMilestoneItem[] | MilestoneFailure | "tooMany"> {
  return db.transaction(async (tx) => {
    if (!(await openProject(tx, projectId))) return "projectNotFound";
    const [row] = await tx
      .select({ deletedAt: projectMilestones.deletedAt })
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, projectId)));
    if (!row) return "milestoneNotFound";
    if (row.deletedAt === null) return selectMilestones(tx, projectId);
    const current = await selectMilestones(tx, projectId);
    if (current.length >= MAX_MILESTONES_PER_PROJECT) return "tooMany";
    const anchor = afterId ? current.findIndex((item) => item.id === afterId) : -1;
    const at = anchor !== -1 ? anchor + 1 : Math.min(position, current.length);
    await tx
      .update(projectMilestones)
      .set({ sortOrder: sql`${projectMilestones.sortOrder} + 1` })
      .where(
        and(eq(projectMilestones.projectId, projectId), live, gte(projectMilestones.sortOrder, at)),
      );
    await tx
      .update(projectMilestones)
      .set({ deletedAt: null, sortOrder: at })
      .where(
        and(
          eq(projectMilestones.id, id),
          eq(projectMilestones.projectId, projectId),
          isNotNull(projectMilestones.deletedAt),
        ),
      );
    await renumber(tx, projectId);
    return selectMilestones(tx, projectId);
  });
}

/**
 * Writes the new order of a project's live milestones. `"staleOrder"` (writing nothing) when
 * `ids` is not exactly that set: one was added or deleted elsewhere, or the request was tampered
 * with (an id from another project, or a deleted one). `sort_order` ends up 0…n-1.
 */
export async function reorderMilestonesByIds(
  db: Database,
  projectId: string,
  ids: readonly string[],
): Promise<ProjectMilestoneItem[] | "projectNotFound" | "staleOrder"> {
  return db.transaction(async (tx) => {
    if (!(await openProject(tx, projectId))) return "projectNotFound";
    const current = await selectMilestones(tx, projectId);
    if (
      !isSameIdSet(
        current.map((milestone) => milestone.id),
        ids,
      )
    ) {
      return "staleOrder";
    }
    const position = new Map(current.map((milestone) => [milestone.id, milestone.sortOrder]));
    const changed = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => position.get(id) !== index);
    if (changed.length > 0) {
      const cases = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(projectMilestones)
        .set({ sortOrder: sql`case ${projectMilestones.id} ${cases} end` })
        .where(
          and(
            eq(projectMilestones.projectId, projectId),
            live,
            sql`${projectMilestones.id} in (${sql.join(
              changed.map(({ id }) => sql`${id}::uuid`),
              sql`, `,
            )})`,
          ),
        );
    }
    return selectMilestones(tx, projectId);
  });
}
