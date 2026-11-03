// Composition root of what `notes` adds to the screens of other modules (SPEC-notes "Contratos").
// N1: the «Nota de hoy» key on Hoy's header (`/`), so `today` never imports `notes`
// (eslint.config.mjs lets only src/lib and the notes pages do it). Like review-extensions.tsx:
// nothing to register, the home page awaits `getTodayNoteSlot(now)` with its other reads and
// renders the node it returns. N2 adds `<NoteMentions type id />` here for the detail pages.
//
// The provider is imported BY NAME, never a side-effect-only `import "…"` (package.json declares
// every JS module free of side effects: the bundler would drop it, see progress-sources.ts).
import "server-only";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import { TodayNoteKey } from "@/modules/notes/components/today-note-key";
import { getTodayNoteState } from "@/modules/notes/contracts";

/**
 * Hoy's key for the page's instant `now`: «Nota de hoy», or «Seguir la nota de hoy» when today's
 * note has text, with the `N` hint when shortcuts are on. Call it with the page's other reads,
 * after `requireOwner()`.
 */
export async function getTodayNoteSlot(now: Date): Promise<ReactNode> {
  const [{ day, hasText }, cookieStore] = await Promise.all([getTodayNoteState(now), cookies()]);
  const shortcuts = areShortcutsEnabled(cookieStore.get(SHORTCUTS_COOKIE)?.value);
  return <TodayNoteKey day={day} hasText={hasText} shortcuts={shortcuts} />;
}
