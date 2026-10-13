// The weekly objective's data access (server only; SPEC-goals "Objetivo semanal"). These
// functions take the database and trust their input: the actions check the owner and validate
// first (weekly-input.ts).
//
// Lock: `(5000, hashtext('goals:weekly:' || weekStart))`, the FIRST lock of every transaction here
// (CLAUDE.md "Advisory locks": two keys, never after a row lock). Two edits of the same week
// wait for each other, so concurrent sets end with one row (the last one) and an undo reads the
// week as it is when its turn comes. Different weeks never wait.
//
// Clearing deletes the row (`weekly_objectives` has no `deleted_at`: it is one short text, and the
// undo carries the text it removed). decisión autónoma para revisar con el owner.
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { weeklyObjectives } from "./db/schema";
import { GOALS_ADVISORY_SPACE, goalsWeekKey } from "./lock-keys";
import type {
  WeeklyObjectiveChange,
  WeeklyObjectiveItem,
  WeeklyObjectiveUndo,
} from "./weekly-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The week's lock. Must be the first lock of the transaction. */
function lockWeek(tx: Tx, weekStart: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(GOALS_ADVISORY_SPACE))}, hashtext(${goalsWeekKey(weekStart)}))`,
  );
}

async function textOf(tx: Tx | Database, weekStart: string): Promise<string | null> {
  const [row] = await tx
    .select({ text: weeklyObjectives.text })
    .from(weeklyObjectives)
    .where(eq(weeklyObjectives.weekStart, weekStart));
  return row?.text ?? null;
}

/** The objective of the week starting `weekStart`, or null when none was set. */
export async function selectWeeklyObjective(
  db: Database,
  weekStart: string,
): Promise<WeeklyObjectiveItem | null> {
  const text = await textOf(db, weekStart);
  return text === null ? null : { weekStart, text };
}

async function write(tx: Tx, weekStart: string, text: string | null) {
  if (text === null) {
    await tx.delete(weeklyObjectives).where(eq(weeklyObjectives.weekStart, weekStart));
    return;
  }
  await tx
    .insert(weeklyObjectives)
    .values({ weekStart, text })
    .onConflictDoUpdate({ target: weeklyObjectives.weekStart, set: { text } });
}

/** Sets or replaces the week's objective (upsert by `weekStart`); returns the text it replaced. */
export async function upsertWeeklyObjective(
  db: Database,
  { weekStart, text }: { weekStart: string; text: string },
): Promise<WeeklyObjectiveChange> {
  return db.transaction(async (tx) => {
    await lockWeek(tx, weekStart);
    const previous = await textOf(tx, weekStart);
    await write(tx, weekStart, text);
    return { weekStart, text, previous };
  });
}

/** Clears the week's objective; returns the text it removed (null: there was none). */
export async function clearWeeklyObjectiveRow(
  db: Database,
  weekStart: string,
): Promise<WeeklyObjectiveChange> {
  return db.transaction(async (tx) => {
    await lockWeek(tx, weekStart);
    const previous = await textOf(tx, weekStart);
    await write(tx, weekStart, null);
    return { weekStart, text: null, previous };
  });
}

/**
 * "Deshacer" of a set or a clear: puts `previous` back (null: the week had none) but only while
 * the week still holds `applied` (what that change left). If something changed it meanwhile
 * (another edit, or the undo itself already ran), nothing is written and `restored` is false:
 * an undo never overwrites "whatever is current".
 */
export async function undoWeeklyObjectiveRow(
  db: Database,
  {
    weekStart,
    previous,
    applied,
  }: { weekStart: string; previous: string | null; applied: string | null },
): Promise<WeeklyObjectiveUndo> {
  return db.transaction(async (tx) => {
    await lockWeek(tx, weekStart);
    const current = await textOf(tx, weekStart);
    if (current !== applied) return { weekStart, text: current, restored: false };
    await write(tx, weekStart, previous);
    return { weekStart, text: previous, restored: true };
  });
}
