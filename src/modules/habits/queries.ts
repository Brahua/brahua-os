// Reads of `habits` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "./habit-input";
import { selectActiveHabits } from "./habits";
import { selectArchivedHabits } from "./organize";

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
