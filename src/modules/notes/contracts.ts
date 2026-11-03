// What `notes` offers the rest of the app (SPEC-notes "Contratos"). Only the composition roots in
// src/lib read it (eslint.config.mjs: no module imports `notes`). Server only.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { selectDayHasText } from "./notes";

/** What Hoy's key needs: whether today's note (Lima's day of `now`) already has text. */
export type TodayNoteState = { day: string; hasText: boolean };

/**
 * Today's note for the key on Hoy: «Nota de hoy», or «Seguir la nota de hoy» when it has text.
 * One query.
 */
export async function getTodayNoteState(now: Date): Promise<TodayNoteState> {
  await requireOwner();
  const day = ownerDateKey(now);
  return { day, hasText: await selectDayHasText(getDb(), day) };
}
