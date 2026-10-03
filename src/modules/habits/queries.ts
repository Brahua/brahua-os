// Reads of `habits` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import type { DeletedHabit, HabitItem } from "./habit-input";
import { selectActiveHabits, type LoadedHabit } from "./habits";
import {
  selectDeletedHabit,
  selectHabitDetail,
  selectHabitsWeek,
  type HabitsWeek,
} from "./history";
import { selectArchivedHabits } from "./organize";

const habitId = z.uuid();

/**
 * The active habits (neither archived nor deleted) with today's log (Lima day of `now`), in their
 * manual order. "Hoy" picks the ones due today (`dueOn`).
 */
export async function listActiveHabits(now: Date): Promise<HabitItem[]> {
  await requireOwner();
  return selectActiveHabits(getDb(), ownerDateKey(now));
}

/** The archived habits (not deleted), in their old order: "Archivados" with "Reactivar" (H2). */
export async function listArchivedHabits(now: Date): Promise<HabitItem[]> {
  await requireOwner();
  return selectArchivedHabits(getDb(), ownerDateKey(now));
}

/** H5: the "Semana" view for `?semana=` (any day of the week; the current week by default). */
export async function getHabitsWeek(now: Date, requested?: string | string[]): Promise<HabitsWeek> {
  await requireOwner();
  return selectHabitsWeek(getDb(), ownerDateKey(now), requested);
}

/**
 * H5: a habit for its page (archived ones too), with every log of `month` (`YYYY-MM`) for the
 * calendar; `today` is Lima's (`ownerDateKey`). Null when it doesn't exist, is deleted or the id
 * is malformed (the page is a 404). Cached per request: the page's metadata reads it too.
 */
export const getHabitDetail = cache(
  async (id: string, month: string, today: string): Promise<LoadedHabit | null> => {
    await requireOwner();
    // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
    if (!habitId.safeParse(id).success) return null;
    return selectHabitDetail(getDb(), id, month, today);
  },
);

/**
 * H5: a habit just deleted from its page (`?deleted=<id>` on /habits: "Hábito eliminado ·
 * Deshacer"), or null when the id is malformed, missing or the habit isn't deleted.
 */
export async function getDeletedHabit(id: string): Promise<DeletedHabit | null> {
  await requireOwner();
  if (!habitId.safeParse(id).success) return null;
  return selectDeletedHabit(getDb(), id);
}
