// Composition root of what `notes` adds to the screens of other modules (SPEC-notes "Contratos").
// N1: the «Nota de hoy» key on Hoy's header (`/`), so `today` never imports `notes`
// (eslint.config.mjs lets only src/lib and the notes pages do it). Like review-extensions.tsx:
// nothing to register, the home page awaits `getTodayNoteSlot(now)` with its other reads and
// renders the node it returns. N2: `<NoteMentions type id />` at the end of the detail pages of
// projects, tasks, habits, goals and learning tracks.
//
// The provider is imported BY NAME, never a side-effect-only `import "…"` (package.json declares
// every JS module free of side effects: the bundler would drop it, see progress-sources.ts).
import "server-only";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import type { NoteLinkType } from "@/lib/markdown/note-links";
import { NoteBacklinks } from "@/modules/notes/components/note-backlinks";
import { TodayNoteKey } from "@/modules/notes/components/today-note-key";
import { getNoteMentions, getTodayNoteState } from "@/modules/notes/contracts";
import { NOTES_COPY } from "@/modules/notes/copy";

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

/** The entities whose pages show «Mencionado en» (every link type but notes, which have «Enlazada desde»). */
export type NoteMentionsType = Exclude<NoteLinkType, "note">;

/**
 * «Mencionado en N notas» (SPEC-notes "Backlinks hacia los módulos", N2): the live notes that link to
 * this project, task, habit, goal or track, at the end of its page. Nothing without mentions. A
 * Server Component (async): the detail pages render `<NoteMentions type="project" id={id} />` and
 * never import `notes`. One query.
 */
export async function NoteMentions({
  type,
  id,
  className,
}: {
  type: NoteMentionsType;
  id: string;
  /** The page's reading width, so the section measures what its siblings do (e.g. `max-w-160`). */
  className?: string;
}) {
  const notes = await getNoteMentions(type, id);
  return (
    <NoteBacklinks
      className={className}
      title={NOTES_COPY.mentionedInTitle(notes.length)}
      notes={notes}
      headingId="note-mentions-title"
      marker="note-mentions"
    />
  );
}
