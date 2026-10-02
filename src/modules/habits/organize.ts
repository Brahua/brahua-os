// H2's writes and reads of `habits` (server only): edit, reorder, archive and reactivate, and the
// archived list. Like habits.ts, these functions take the database and trust their input: the
// actions check the owner and validate first.
//
// Locks (the rule of habits.ts: advisory locks first, never after a row lock; with both, the
// order lock before the habit's):
// - reorder, archive and reactivate take the order lock `(4000, hashtext('habits:order'))`
//   (they change which habits are active or their order);
// - edit takes the habit's own `(4000, hashtext(<id>))` (H3's goal changes take it too), then
//   the habit FOR UPDATE and a new area FOR SHARE.
import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { planReorder } from "@/modules/core/life-area-order";
import { lifeAreas } from "@/modules/core/db/schema";
import { habits } from "./db/schema";
import { frequencyColumns } from "./frequency-input";
import type { HabitItem, UpdateHabitInput } from "./habit-input";
import {
  activeHabit,
  lockHabit,
  lockHabitsOrder,
  selectHabitItemById,
  selectItems,
  visibleHabit,
  type HabitFailure,
} from "./habits";
import type { UnarchiveHabitInput } from "./organize-input";
import { applyMeasureUpdate } from "./quantity";

/** The archived habits (not deleted) with `today`'s log, in their old order. */
export async function selectArchivedHabits(db: Database, today: string): Promise<HabitItem[]> {
  return selectItems(db, today, and(visibleHabit, isNotNull(habits.archivedAt)));
}

/**
 * Edits an active habit's name, area and frequency (each frequency with exactly its own field;
 * the others are cleared). Never its kind or measure; a quantity's goal, unit and step (H3, from
 * today on: `applyMeasureUpdate`). A habit to avoid stays daily ("avoidDaily"). A new area must be active; the one it already
 * has stays even if it was archived since (SPEC-habits "Área"). Returns the habit as it is on
 * `today`, or why not ("archived": reactivate it first).
 */
export async function updateHabitById(
  db: Database,
  input: UpdateHabitInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const [habit] = await tx
      .select({
        lifeAreaId: habits.lifeAreaId,
        archivedAt: habits.archivedAt,
        kind: habits.kind,
        measure: habits.measure,
      })
      .from(habits)
      .where(and(eq(habits.id, input.id), visibleHabit))
      .for("update");
    if (!habit) return "notFound";
    if (habit.archivedAt !== null) return "archived";
    // H3: a habit to avoid is daily; only a quantity has a goal, unit and step.
    if (habit.kind === "avoid" && input.frequency !== "daily") return "avoidDaily";
    const measure =
      input.goal !== undefined && input.unit !== undefined
        ? { goal: input.goal, unit: input.unit, step: input.step ?? 1 }
        : null;
    if (measure && habit.measure !== "quantity") return "notQuantity";
    if (input.lifeAreaId !== null && input.lifeAreaId !== habit.lifeAreaId) {
      const [area] = await tx
        .select({ id: lifeAreas.id })
        .from(lifeAreas)
        .where(and(eq(lifeAreas.id, input.lifeAreaId), isNull(lifeAreas.archivedAt)))
        .for("share");
      if (!area) return "areaUnavailable";
    }
    await tx
      .update(habits)
      .set({ name: input.name, lifeAreaId: input.lifeAreaId, ...frequencyColumns(input) })
      .where(eq(habits.id, input.id));
    if (measure) await applyMeasureUpdate(tx, input.id, measure, today);
    return (await selectHabitItemById(tx, input.id, today)) as HabitItem;
  });
}

/**
 * Puts the active habits in the order of `ids`. Archived and deleted habits keep their slots
 * (so reactivating "in place" or restoring a deleted one puts it back where it was) and every
 * habit gets a position, so `sort_order` ends up contiguous (0…n-1). False, writing nothing, when
 * `ids` isn't exactly the active habits (a stale list on screen, or a tampered request).
 */
export async function reorderHabitsByIds(db: Database, ids: readonly string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    // Every row, deleted ones too: they hold slots, never visible ones.
    const rows = await tx
      .select({
        id: habits.id,
        sortOrder: habits.sortOrder,
        archivedAt: habits.archivedAt,
        deletedAt: habits.deletedAt,
      })
      .from(habits)
      .orderBy(habits.sortOrder, habits.id);
    const plan = planReorder(
      rows.map((row) => ({
        id: row.id,
        archived: row.archivedAt !== null || row.deletedAt !== null,
      })),
      ids,
    );
    if (!plan) return false;
    // Only the rows whose position changes, in one statement.
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    const changed = plan
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => current.get(id) !== index);
    if (changed.length > 0) {
      const position = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(habits)
        .set({ sortOrder: sql`case ${habits.id} ${position} end` })
        .where(
          sql`${habits.id} in (${sql.join(
            changed.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }
    return true;
  });
}

/**
 * Archives an active habit: out of "Hoy" (and later "Semana" and `today`), everything kept. Its
 * place stays, so the archive's "Deshacer" puts it back there. Archiving twice changes nothing.
 * Null when it doesn't exist or is deleted.
 */
export async function archiveHabitById(
  db: Database,
  id: string,
  today: string,
): Promise<HabitItem | null> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    await tx
      .update(habits)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(habits.id, id), activeHabit));
    return selectHabitItemById(tx, id, today);
  });
}

/**
 * Reactivates an archived habit: at the end of the order (`end`, "Reactivar": after every habit,
 * deleted and archived ones too, like a new one) or in its old place (`original`, the archive's
 * "Deshacer"). Reactivating an active habit changes nothing. Null when it doesn't exist or is
 * deleted.
 */
export async function unarchiveHabitById(
  db: Database,
  { id, position }: UnarchiveHabitInput,
  today: string,
): Promise<HabitItem | null> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    const last = sql`(select coalesce(max(${habits.sortOrder}) + 1, 0) from ${habits})`;
    await tx
      .update(habits)
      .set({
        archivedAt: null,
        ...(position === "end" ? { sortOrder: sql<number>`${last}` } : {}),
      })
      .where(and(eq(habits.id, id), visibleHabit, isNotNull(habits.archivedAt)));
    return selectHabitItemById(tx, id, today);
  });
}
