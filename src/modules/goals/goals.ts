// Goals data access (server only). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries
// with requireOwner()).
//
// Locks (CLAUDE.md "Advisory locks"; SPEC-goals "Modelo de datos"), all in `GOALS_ADVISORY_SPACE`
// (5000), two keys:
// - `(5000, hashtext('goals:order'))` (`lockGoalsOrder`): anything that changes which goals are
//   visible or active, or their order: create, reorder, archive, unarchive, delete and restore.
//   Keeps `position` contiguous, like `habits`.
// - `(5000, hashtext(<goal id>))` (`lockGoal`): one goal's entries, edits, achieved and reopened
//   state, delete and restore. Two "+1" at the same time wait for each other, so the sum counts
//   both and the goal is achieved once.
// Rule: advisory locks are always the first locks of the transaction, never taken after a row
// lock; with both, the order lock first, then the goal's. Only then the rows: the goal FOR UPDATE,
// the area FOR SHARE.
import "server-only";
import { and, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { planReorder } from "@/modules/core/life-area-order";
// `goals` reads habits and projects only through their contracts (eslint.config.mjs).
import { selectHabitAvailability, selectHabitsDoneDays } from "@/modules/habits/contracts";
import { selectProjectAvailability, selectProjectsProgress } from "@/modules/projects/contracts";
import { GOAL_PROJECT_TARGET } from "./goal-constants";
import { goalEntries, goals } from "./db/schema";
import type {
  AddEntryInput,
  CreateGoalInput,
  DeletedGoal,
  GoalEntryItem,
  GoalItem,
  GoalSourceReading,
  UnarchiveGoalInput,
  UndoEntryInput,
  UpdateGoalInput,
} from "./goal-input";
import { GOALS_ADVISORY_SPACE, GOALS_ORDER_KEY } from "./lock-keys";
import { sourceReached } from "./goal-text";
import { periodBounds, periodOf } from "./pace";
import { achievementChange } from "./progress";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export { GOALS_ADVISORY_SPACE, GOALS_ORDER_KEY } from "./lock-keys";

async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(GOALS_ADVISORY_SPACE))}, hashtext(${key}))`,
  );
}

/** The order lock. Must be the first lock of the transaction (see the header). */
export function lockGoalsOrder(tx: Tx) {
  return advisoryLock(tx, GOALS_ORDER_KEY);
}

/** One goal's lock. First locks only (after the order lock, when both are taken). */
export function lockGoal(tx: Tx, id: string) {
  return advisoryLock(tx, id);
}

/**
 * Whether a goal is visible (SPEC-goals "Eliminar"): not deleted. EVERY read and write of goals
 * must filter with it; entries through `ofVisibleGoal`.
 */
export const visibleGoal = isNull(goals.deletedAt);

/** For reads of `goal_entries`: the entry's goal is visible (a deleted goal's entries hide with it). */
export function ofVisibleGoal(goalId: typeof goalEntries.goalId): SQL {
  return sql`exists (
    select 1 from goals visible_goal
    where visible_goal.id = ${goalId} and visible_goal.deleted_at is null
  )`;
}

/** Why a write was refused. */
export type GoalFailure =
  | "notFound"
  | "archived"
  | "areaUnavailable"
  /** The habit or project it would follow doesn't exist, is deleted (or, new, archived). */
  | "sourceUnavailable"
  /** An entry on a goal that isn't measured by a quantity. */
  | "notManual"
  /** "Reabrir" on a habit or project goal whose source still reaches the target. */
  | "sourceReached"
  | "entryNotFound";

/** The sum of a goal's entries that were not undone. */
const sumColumn = sql<number>`coalesce((
  select sum(entry.delta) from goal_entries entry
  where entry.goal_id = ${goals.id} and entry.deleted_at is null
), 0)`.mapWith(Number);

/**
 * Goals as `GoalItem`s, in their manual order, with the sum of their entries and, for habit and
 * project goals, what their source reads on the day of `now` (`readSources`). Callers filter with
 * `visibleGoal`. A fixed number of queries whatever the number of goals: the goals, then up to
 * three for the habits and up to three for the projects.
 */
export async function selectGoalItems(
  db: Database | Tx,
  where?: SQL,
  now: Date = new Date(),
): Promise<GoalItem[]> {
  const rows = await db
    .select({
      id: goals.id,
      title: goals.title,
      notes: goals.notes,
      periodKind: goals.periodKind,
      year: goals.year,
      quarter: goals.quarter,
      sourceKind: goals.sourceKind,
      habitId: goals.habitId,
      projectId: goals.projectId,
      target: goals.target,
      unit: goals.unit,
      status: goals.status,
      achievedAt: goals.achievedAt,
      position: goals.position,
      area: {
        id: lifeAreas.id,
        slug: lifeAreas.slug,
        name: lifeAreas.name,
        icon: lifeAreas.icon,
        color: lifeAreas.color,
      },
      sum: sumColumn,
    })
    .from(goals)
    .leftJoin(lifeAreas, eq(lifeAreas.id, goals.areaId))
    .where(where)
    .orderBy(goals.position, goals.id);
  const items = rows.map(({ achievedAt, ...row }): GoalItem => ({
    ...row,
    achievedAt: achievedAt ? achievedAt.toISOString() : null,
    source: null,
  }));
  return readSources(db, items, now);
}

/**
 * Fills `source` of the habit and project goals (G2): the habit's days done between the period's
 * first day and its last (counted up to Lima's today, `getHabitDoneDays`' rules) and the
 * project's whole percent and state (`getProjectProgress`'s). A source that no longer exists
 * stays null (the row says so). Reads only; the habit reads are batched across goals.
 */
async function readSources(db: Database | Tx, items: GoalItem[], now: Date): Promise<GoalItem[]> {
  const habitGoals = items.filter((goal) => goal.sourceKind === "habit" && goal.habitId);
  const projectGoals = items.filter((goal) => goal.sourceKind === "project" && goal.projectId);
  if (habitGoals.length === 0 && projectGoals.length === 0) return items;
  const sources = new Map<string, GoalSourceReading>();
  if (habitGoals.length > 0) {
    const readings = await selectHabitsDoneDays(
      db,
      habitGoals.map((goal) => {
        const { start, end } = periodBounds(periodOf(goal));
        return { habitId: goal.habitId as string, from: start, to: end };
      }),
      now,
    );
    habitGoals.forEach((goal, index) => {
      const reading = readings[index];
      if (reading) {
        sources.set(goal.id, {
          kind: "habit",
          name: reading.name,
          done: reading.done,
          expected: reading.expected,
        });
      }
    });
  }
  if (projectGoals.length > 0) {
    const progress = await selectProjectsProgress(
      db,
      projectGoals.map((goal) => goal.projectId as string),
    );
    for (const goal of projectGoals) {
      const reading = progress.get(goal.projectId as string);
      if (reading) {
        sources.set(goal.id, {
          kind: "project",
          name: reading.name,
          percent: reading.percent,
          finished: reading.status === "done",
        });
      }
    }
  }
  return items.map((goal) => ({ ...goal, source: sources.get(goal.id) ?? goal.source }));
}

/**
 * Achieves, once, the active habit and project goals whose source reached the target (G2: they
 * are achieved on their own, when they are read, because nothing in `goals` runs when a habit is
 * logged or a project is finished). Each goal goes in its own transaction under its lock, and
 * the UPDATE expects `status = 'active'` and keeps an `achieved_at` that exists, so two reads at
 * once achieve it once. Never reopens: a goal that later drops below its target (the owner
 * edited past logs) stays achieved until "Reabrir" (decisión autónoma para revisar con el owner).
 * Returns the items with the ones achieved here updated. Call it on reads, never inside a
 * transaction (it takes a lock, which must be the first of its own).
 */
export async function settleSourceAchievements(
  db: Database,
  items: GoalItem[],
): Promise<GoalItem[]> {
  const achievedAt = new Map<string, string>();
  for (const goal of items.filter((item) => item.status === "active" && sourceReached(item))) {
    const row = await db.transaction(async (tx) => {
      await lockGoal(tx, goal.id);
      const [achieved] = await tx
        .update(goals)
        .set({ status: "achieved", achievedAt: sql`coalesce(${goals.achievedAt}, now())` })
        .where(and(eq(goals.id, goal.id), visibleGoal, eq(goals.status, "active")))
        .returning({ achievedAt: goals.achievedAt });
      if (achieved) return achieved;
      // Another read achieved it first (or it was archived meanwhile): report what is stored.
      const [current] = await tx
        .select({ achievedAt: goals.achievedAt, status: goals.status })
        .from(goals)
        .where(and(eq(goals.id, goal.id), visibleGoal));
      return current?.status === "achieved" ? current : null;
    });
    if (row?.achievedAt) achievedAt.set(goal.id, row.achievedAt.toISOString());
  }
  if (achievedAt.size === 0) return items;
  return items.map((goal) => {
    const at = achievedAt.get(goal.id);
    return at ? { ...goal, status: "achieved", achievedAt: at } : goal;
  });
}

/** Every visible goal (archived ones too) in its manual order, achieving the ones that reached. */
export async function selectVisibleGoals(
  db: Database,
  now: Date = new Date(),
): Promise<GoalItem[]> {
  return settleSourceAchievements(db, await selectGoalItems(db, visibleGoal, now));
}

/** One visible goal for its page, achieving it if its source reached the target; or null. */
export async function selectGoalForPage(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<GoalItem | null> {
  const [item] = await settleSourceAchievements(
    db,
    await selectGoalItems(db, and(eq(goals.id, id), visibleGoal), now),
  );
  return item ?? null;
}

/**
 * The visible goals that follow a habit or a project (archived ones are left out: they are in
 * "Anteriores"), for the "Metas" section of that habit's or project's page. The newest period
 * first (a year, then its quarters from the last), then the manual order. One `WHERE` with
 * `visibleGoal`, so the number of queries is fixed (see selectGoalItems) whatever the goals.
 */
export async function selectGoalsFollowing(
  db: Database,
  source: { kind: "habit" | "project"; id: string },
  now: Date = new Date(),
): Promise<GoalItem[]> {
  const follows =
    source.kind === "habit" ? eq(goals.habitId, source.id) : eq(goals.projectId, source.id);
  const items = await settleSourceAchievements(
    db,
    await selectGoalItems(db, and(visibleGoal, ne(goals.status, "archived"), follows), now),
  );
  // A year-long goal lists before the quarters of that year.
  const rank = (goal: GoalItem) => goal.year * 10 + (goal.quarter ?? 5);
  return items.sort((a, b) => rank(b) - rank(a) || a.position - b.position);
}

/** One visible goal, or null. */
export async function selectGoalItemById(db: Database | Tx, id: string): Promise<GoalItem | null> {
  const [item] = await selectGoalItems(db, and(eq(goals.id, id), visibleGoal));
  return item ?? null;
}

/** A goal's entries that were not undone, newest first (the detail's history). */
export async function selectGoalEntries(db: Database, goalId: string): Promise<GoalEntryItem[]> {
  const rows = await db
    .select({
      id: goalEntries.id,
      delta: goalEntries.delta,
      entryDate: goalEntries.entryDate,
      createdAt: goalEntries.createdAt,
    })
    .from(goalEntries)
    .where(
      and(
        eq(goalEntries.goalId, goalId),
        isNull(goalEntries.deletedAt),
        ofVisibleGoal(goalEntries.goalId),
      ),
    )
    .orderBy(desc(goalEntries.createdAt), desc(goalEntries.id))
    .limit(500);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** A deleted goal for the "Meta eliminada · Deshacer" notice, or null. */
export async function selectDeletedGoal(db: Database, id: string): Promise<DeletedGoal | null> {
  const [row] = await db
    .select({ id: goals.id, title: goals.title })
    .from(goals)
    .where(and(eq(goals.id, id), isNotNull(goals.deletedAt)));
  return row ?? null;
}

/** An area must be active when a goal is put in it (read FOR SHARE: an archive at the same time waits). */
async function areaIsActive(tx: Tx, areaId: string): Promise<boolean> {
  const [area] = await tx
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(and(eq(lifeAreas.id, areaId), isNull(lifeAreas.archivedAt)))
    .for("share");
  return Boolean(area);
}

async function sumOf(tx: Tx, goalId: string): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<number>`coalesce(sum(${goalEntries.delta}), 0)`.mapWith(Number) })
    .from(goalEntries)
    .where(and(eq(goalEntries.goalId, goalId), isNull(goalEntries.deletedAt)));
  return row.sum;
}

/**
 * Applies what a change of progress does to the status (`achievementChange`): achieved once
 * (`achieved_at` only set while it is null) or reopened. The UPDATE checks the status it expects,
 * so a repeat changes nothing. True when the goal was achieved by this call.
 */
async function settleAchievement(
  tx: Tx,
  goalId: string,
  args: { status: "active" | "achieved" | "archived"; wasReached: boolean; nowReached: boolean },
): Promise<boolean> {
  const change = achievementChange(args);
  if (change === "achieve") {
    const changed = await tx
      .update(goals)
      .set({ status: "achieved", achievedAt: sql`coalesce(${goals.achievedAt}, now())` })
      .where(and(eq(goals.id, goalId), eq(goals.status, "active")))
      .returning({ id: goals.id });
    return changed.length > 0;
  }
  if (change === "reopen") {
    await tx
      .update(goals)
      .set({ status: "active", achievedAt: null })
      .where(and(eq(goals.id, goalId), eq(goals.status, "achieved")));
  }
  return false;
}

type SourceFields = {
  sourceKind: "habit" | "project" | "manual";
  habitId: string | null;
  projectId: string | null;
  target: number;
  unit: string | null;
};

/** The columns a source owns, exactly as the CHECKs ask (a goal has only its own source's). */
function sourceColumns(input: CreateGoalInput | UpdateGoalInput): SourceFields {
  switch (input.sourceKind) {
    case "habit":
      return {
        sourceKind: "habit",
        habitId: input.habitId,
        projectId: null,
        target: input.target,
        unit: null,
      };
    case "project":
      return {
        sourceKind: "project",
        habitId: null,
        projectId: input.projectId,
        target: GOAL_PROJECT_TARGET,
        unit: null,
      };
    case "manual":
      return {
        sourceKind: "manual",
        habitId: null,
        projectId: null,
        target: input.target,
        unit: input.unit,
      };
  }
}

/**
 * Whether the habit or project a goal would follow can be followed: a habit must exist and be
 * active (a new goal never follows an archived one); a project must exist and not be deleted
 * (any state). Read in the goal's transaction. A manual goal always can.
 */
async function sourceIsAvailable(tx: Tx, source: SourceFields): Promise<boolean> {
  if (source.sourceKind === "habit" && source.habitId) {
    return (await selectHabitAvailability(tx, [source.habitId])).get(source.habitId) === "active";
  }
  if (source.sourceKind === "project" && source.projectId) {
    return (await selectProjectAvailability(tx, [source.projectId])).has(source.projectId);
  }
  return true;
}

/**
 * Creates a goal at the end of the manual order (deleted and archived ones included, so a
 * restored goal gets its old place back and two goals never share one). A habit or project goal
 * needs a habit (active) or project (not deleted) that exists ("sourceUnavailable" otherwise);
 * one whose source already reached the target is achieved right away.
 */
export async function insertGoal(
  db: Database,
  input: CreateGoalInput,
): Promise<GoalItem | GoalFailure> {
  const created = await db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    if (input.areaId !== null && !(await areaIsActive(tx, input.areaId))) return "areaUnavailable";
    const source = sourceColumns(input);
    if (!(await sourceIsAvailable(tx, source))) return "sourceUnavailable";
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${goals.position}) + 1, 0)`.mapWith(Number) })
      .from(goals);
    const [row] = await tx
      .insert(goals)
      .values({
        title: input.title,
        notes: input.notes,
        periodKind: input.periodKind,
        year: input.year,
        quarter: input.periodKind === "quarter" ? input.quarter : null,
        ...source,
        areaId: input.areaId,
        position: next,
      })
      .returning({ id: goals.id });
    return (await selectGoalItemById(tx, row.id)) as GoalItem;
  });
  if (typeof created === "string") return created;
  return (await settleSourceAchievements(db, [created]))[0];
}

/**
 * Edits a goal's title, notes, area and source (never its period). Changing the source (another
 * habit or project, or another kind) resets the reading and keeps the manual entries
 * (SPEC-goals "Fuente de avance"); an achieved goal goes back to active then, because its
 * achievement came from the old source, and is achieved again on the next read if the new one
 * already reached the target (decisión autónoma para revisar con el owner). The new habit or
 * project must be available; keeping the goal's own source needs nothing (it may be archived or
 * gone, and the title is still editable). A new target may achieve the goal or reopen it
 * (`achievementChange`). An area must be active unless it is the one the goal already has.
 * Refused on an archived goal: reactivate it first.
 */
export async function updateGoalById(
  db: Database,
  input: UpdateGoalInput,
): Promise<GoalItem | GoalFailure> {
  const updated = await db.transaction(async (tx) => {
    await lockGoal(tx, input.id);
    const [goal] = await tx
      .select({
        areaId: goals.areaId,
        status: goals.status,
        sourceKind: goals.sourceKind,
        habitId: goals.habitId,
        projectId: goals.projectId,
        target: goals.target,
        periodKind: goals.periodKind,
        year: goals.year,
        quarter: goals.quarter,
      })
      .from(goals)
      .where(and(eq(goals.id, input.id), visibleGoal))
      .for("update");
    if (!goal) return "notFound";
    if (goal.status === "archived") return "archived";
    if (
      input.areaId !== null &&
      input.areaId !== goal.areaId &&
      !(await areaIsActive(tx, input.areaId))
    ) {
      return "areaUnavailable";
    }
    const source = sourceColumns(input);
    const sourceChanged =
      source.sourceKind !== goal.sourceKind ||
      source.habitId !== goal.habitId ||
      source.projectId !== goal.projectId;
    if (sourceChanged && !(await sourceIsAvailable(tx, source))) return "sourceUnavailable";
    await tx
      .update(goals)
      .set({
        title: input.title,
        notes: input.notes,
        areaId: input.areaId,
        ...source,
        ...(sourceChanged && goal.status === "achieved"
          ? { status: "active" as const, achievedAt: null }
          : {}),
      })
      .where(eq(goals.id, input.id));
    if (sourceChanged && source.sourceKind === "manual") {
      // Back to a quantity: the entries that were kept may already reach the target.
      const sum = await sumOf(tx, input.id);
      await settleAchievement(tx, input.id, {
        status: "active",
        wasReached: false,
        nowReached: sum >= source.target,
      });
    } else if (!sourceChanged && source.target !== goal.target) {
      if (source.sourceKind === "manual") {
        const sum = await sumOf(tx, input.id);
        await settleAchievement(tx, input.id, {
          status: goal.status,
          wasReached: sum >= goal.target,
          nowReached: sum >= source.target,
        });
      } else if (source.sourceKind === "habit" && source.habitId) {
        const { start, end } = periodBounds(periodOf(goal));
        const [reading] = await selectHabitsDoneDays(
          tx,
          [{ habitId: source.habitId, from: start, to: end }],
          new Date(),
        );
        const done = reading?.done ?? 0;
        await settleAchievement(tx, input.id, {
          status: goal.status,
          wasReached: done >= goal.target,
          nowReached: done >= source.target,
        });
      }
    }
    return (await selectGoalItemById(tx, input.id)) as GoalItem;
  });
  if (typeof updated === "string") return updated;
  return (await settleSourceAchievements(db, [updated]))[0];
}

/**
 * Puts the non-archived goals in the order of `ids`. Archived and deleted goals keep their slots
 * and every goal gets a position, so `position` ends up contiguous (0…n-1). False, writing
 * nothing, when `ids` isn't exactly the non-archived visible goals (a stale list, or a tampered
 * request).
 */
export async function reorderGoalsByIds(db: Database, ids: readonly string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    // Every row, deleted ones too: they hold slots, never visible ones.
    const rows = await tx
      .select({
        id: goals.id,
        position: goals.position,
        status: goals.status,
        deletedAt: goals.deletedAt,
      })
      .from(goals)
      .orderBy(goals.position, goals.id);
    const plan = planReorder(
      rows.map((row) => ({
        id: row.id,
        archived: row.status === "archived" || row.deletedAt !== null,
      })),
      ids,
    );
    if (!plan) return false;
    const current = new Map(rows.map((row) => [row.id, row.position]));
    const changed = plan
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => current.get(id) !== index);
    if (changed.length > 0) {
      const position = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(goals)
        .set({ position: sql`case ${goals.id} ${position} end` })
        .where(
          sql`${goals.id} in (${sql.join(
            changed.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }
    return true;
  });
}

/**
 * Archives a goal: out of the sections, in "Anteriores", everything kept (its achieved date too).
 * Its place stays, so the archive's "Deshacer" puts it back there. Twice changes nothing. Null
 * when it doesn't exist or is deleted.
 */
export async function archiveGoalById(db: Database, id: string): Promise<GoalItem | null> {
  return db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    await tx
      .update(goals)
      .set({ status: "archived" })
      .where(and(eq(goals.id, id), visibleGoal, sql`${goals.status} <> 'archived'`));
    return selectGoalItemById(tx, id);
  });
}

/**
 * Reactivates an archived goal: back to `achieved` if it had been achieved, else `active`; at the
 * end of the order (`end`, "Reactivar") or in its old place (`original`, the archive's
 * "Deshacer"). Reactivating a goal that isn't archived changes nothing. Null when it doesn't
 * exist or is deleted.
 */
export async function unarchiveGoalById(
  db: Database,
  { id, position }: UnarchiveGoalInput,
): Promise<GoalItem | null> {
  return db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    const last = sql`(select coalesce(max(${goals.position}) + 1, 0) from ${goals})`;
    await tx
      .update(goals)
      .set({
        status: sql`case when ${goals.achievedAt} is not null then 'achieved' else 'active' end`,
        ...(position === "end" ? { position: sql<number>`${last}` } : {}),
      })
      .where(and(eq(goals.id, id), visibleGoal, eq(goals.status, "archived")));
    return selectGoalItemById(tx, id);
  });
}

/**
 * Soft delete: stamps `deleted_at`, so the goal (with its entries) leaves every view but stays in
 * `pnpm db:export`. Null when it doesn't exist or is already deleted.
 */
export async function softDeleteGoal(db: Database, id: string): Promise<DeletedGoal | null> {
  return db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    await lockGoal(tx, id);
    const [deleted] = await tx
      .update(goals)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(goals.id, id), visibleGoal))
      .returning({ id: goals.id, title: goals.title });
    return deleted ?? null;
  });
}

/**
 * Undoes a soft delete, back in its place in the order. Restoring one that isn't deleted changes
 * nothing (a second "Deshacer" is not an error). Null only when the goal doesn't exist at all.
 */
export async function restoreGoalById(db: Database, id: string): Promise<GoalItem | null> {
  return db.transaction(async (tx) => {
    await lockGoalsOrder(tx);
    await lockGoal(tx, id);
    await tx
      .update(goals)
      .set({ deletedAt: null })
      .where(and(eq(goals.id, id), isNotNull(goals.deletedAt)));
    return selectGoalItemById(tx, id);
  });
}

export type EntryResult = {
  goal: GoalItem;
  /** The entry that was written (an undo carries it). */
  entryId: string;
  /** Whether this entry made the goal reach its target (once: a repeat is false). */
  achievedNow: boolean;
};

/**
 * Adds `delta` (the entry `+N`; negative to correct) to a manual goal, today (`today`, Lima).
 * Under the goal's lock: two entries at the same time add up, and the goal is achieved once.
 * Reaching the target achieves it; a correction that drops it below the target reopens it.
 */
export async function addGoalEntry(
  db: Database,
  { goalId, delta }: AddEntryInput,
  today: string,
): Promise<EntryResult | GoalFailure> {
  return db.transaction(async (tx) => {
    await lockGoal(tx, goalId);
    const [goal] = await tx
      .select({ status: goals.status, sourceKind: goals.sourceKind, target: goals.target })
      .from(goals)
      .where(and(eq(goals.id, goalId), visibleGoal))
      .for("update");
    if (!goal) return "notFound";
    if (goal.status === "archived") return "archived";
    if (goal.sourceKind !== "manual") return "notManual";
    const before = await sumOf(tx, goalId);
    const [entry] = await tx
      .insert(goalEntries)
      .values({ goalId, delta, entryDate: today })
      .returning({ id: goalEntries.id });
    const achievedNow = await settleAchievement(tx, goalId, {
      status: goal.status,
      wasReached: before >= goal.target,
      nowReached: before + delta >= goal.target,
    });
    return {
      goal: (await selectGoalItemById(tx, goalId)) as GoalItem,
      entryId: entry.id,
      achievedNow,
    };
  });
}

/**
 * Undoes the exact entry (soft delete) and evaluates the goal again: dropping below the target
 * reopens it. Undoing an entry that was undone already changes nothing (idempotent); an entry of
 * another goal, or one that never existed, is "entryNotFound".
 */
export async function undoGoalEntry(
  db: Database,
  { goalId, entryId }: UndoEntryInput,
): Promise<GoalItem | GoalFailure> {
  return db.transaction(async (tx) => {
    await lockGoal(tx, goalId);
    const [goal] = await tx
      .select({ status: goals.status, target: goals.target })
      .from(goals)
      .where(and(eq(goals.id, goalId), visibleGoal))
      .for("update");
    if (!goal) return "notFound";
    const [removed] = await tx
      .update(goalEntries)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(goalEntries.id, entryId),
          eq(goalEntries.goalId, goalId),
          isNull(goalEntries.deletedAt),
        ),
      )
      .returning({ delta: goalEntries.delta });
    if (!removed) {
      const [existing] = await tx
        .select({ id: goalEntries.id })
        .from(goalEntries)
        .where(and(eq(goalEntries.id, entryId), eq(goalEntries.goalId, goalId)));
      if (!existing) return "entryNotFound";
    } else {
      const after = await sumOf(tx, goalId);
      await settleAchievement(tx, goalId, {
        status: goal.status,
        wasReached: after + removed.delta >= goal.target,
        nowReached: after >= goal.target,
      });
    }
    return (await selectGoalItemById(tx, goalId)) as GoalItem;
  });
}

/**
 * "Marcar lograda" (`achieved: true`) or "Reabrir": the state wanted, not a toggle, so it is
 * idempotent. Marking sets `achieved_at` once; reopening clears it. Refused on an archived goal.
 */
export async function setGoalAchieved(
  db: Database,
  id: string,
  achieved: boolean,
): Promise<GoalItem | GoalFailure> {
  return db.transaction(async (tx) => {
    await lockGoal(tx, id);
    const [goal] = await tx
      .select({ status: goals.status })
      .from(goals)
      .where(and(eq(goals.id, id), visibleGoal))
      .for("update");
    if (!goal) return "notFound";
    if (goal.status === "archived") return "archived";
    if (achieved) {
      await tx
        .update(goals)
        .set({ status: "achieved", achievedAt: sql`coalesce(${goals.achievedAt}, now())` })
        .where(and(eq(goals.id, id), eq(goals.status, "active")));
    } else {
      if (goal.status === "achieved") {
        // A habit or project goal whose source still reaches the target would be achieved again
        // by the next read: say so instead of pretending to reopen it.
        const item = (await selectGoalItemById(tx, id)) as GoalItem;
        if (sourceReached({ ...item, status: "active" })) return "sourceReached";
      }
      await tx
        .update(goals)
        .set({ status: "active", achievedAt: null })
        .where(and(eq(goals.id, id), eq(goals.status, "achieved")));
    }
    return (await selectGoalItemById(tx, id)) as GoalItem;
  });
}
