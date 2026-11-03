import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import { NoteDeletedNotice } from "@/modules/notes/components/note-deleted-notice";
import { NotesScreen } from "@/modules/notes/components/notes-screen";
import { getTodayNoteState } from "@/modules/notes/contracts";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import { kindFromParam, shownFromParam } from "@/modules/notes/note-list";
import { getDeletedNote, listNoteAreas, listNotes } from "@/modules/notes/queries";
import { AREA_PARAM, DELETED_PARAM, KIND_PARAM, SHOWN_PARAM } from "@/modules/notes/routes";

export const metadata: Metadata = { title: `${COPY.pageTitle} · brahua-os` };

const HEADING_ID = "notes-title";

type NotesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/**
 * Notas (SPEC-notes "Lista"): the notes by last edit (pinned first) with their filters, «Nota de
 * hoy» and «Nueva nota». One instant for the page (Lima's today names the daily notes).
 */
export default async function NotesPage({ searchParams }: NotesPageProps) {
  await requireOwner();
  const search = await searchParams;
  const now = new Date();
  const today = ownerDateKey(now);
  const kind = kindFromParam(one(search[KIND_PARAM]));
  const areas = await listNoteAreas();
  // Only an active area filters (an unknown or archived id shows every note).
  const wanted = one(search[AREA_PARAM]);
  const areaId = areas.some((area) => area.id === wanted) ? wanted : null;
  const shown = shownFromParam(one(search[SHOWN_PARAM]));
  const deletedId = one(search[DELETED_PARAM]);
  const shortcuts = areShortcutsEnabled((await cookies()).get(SHORTCUTS_COOKIE)?.value);
  const [list, todayNote, deleted] = await Promise.all([
    listNotes({ kind, areaId, shown }),
    getTodayNoteState(now),
    // Just deleted from its page: the undo notice needs its name (only while it is deleted).
    deletedId ? getDeletedNote(deletedId) : Promise.resolve(null),
  ]);

  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today, changedMessage: COPY.newDay }}
    >
      {/* Bottom padding grows with the notice (--toast-offset): the last row must stay reachable
          under a «Deshacer» notice at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <NotesScreen
          items={list.items}
          more={list.more}
          kind={kind}
          areaId={areaId}
          areas={areas}
          shown={shown}
          today={today}
          todayHasText={todayNote.hasText}
          headingId={HEADING_ID}
          shortcuts={shortcuts}
        />
        <NoteDeletedNotice headingId={HEADING_ID} deleted={deleted} today={today} />
      </div>
    </ScreenServicesProvider>
  );
}
