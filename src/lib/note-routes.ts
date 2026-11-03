// Client-safe composition root for the app's `N` key (src/lib/shortcuts.ts): the navigation
// (`core`) opens today's note without importing `notes` (eslint.config.mjs lets only src/lib and
// the notes pages do it).
import { dailyNotePath } from "@/modules/notes/routes";
import { ownerDateKey } from "./time";

/** Today's note for the instant `now` (Lima's day): `/notes/2026-11-03`. */
export function todayNotePath(now: Date = new Date()): string {
  return dailyNotePath(ownerDateKey(now));
}
