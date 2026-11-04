import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { Markdown } from "@/lib/markdown/markdown";
import { searchNoteLinks } from "@/lib/note-link-actions";
import { NOTE_LINK_SOURCES } from "@/lib/note-link-sources";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import { DailyNoteHeader } from "@/modules/notes/components/daily-note-header";
import { NoteBacklinks } from "@/modules/notes/components/note-backlinks";
import { NoteBody } from "@/modules/notes/components/note-body";
import { PageNoteHeader } from "@/modules/notes/components/page-note-header";
import { NOTES_COPY as COPY } from "@/modules/notes/copy";
import { dailyTitle, parseNoteKey } from "@/modules/notes/note-day";
import {
  getDailyNote,
  getDailyNoteDay,
  getLinkedFrom,
  getNoteLinkResolutions,
  getPageNote,
  listNoteAreas,
} from "@/modules/notes/queries";
import { notePath, NOTES_PATH } from "@/modules/notes/routes";

type NotePageProps = { params: Promise<{ key: string }> };

const HEADING_ID = "note-title";
/** Headings in a note start at h2 (the page's h1 is the note's title or date). */
const HEADING_OFFSET = 1;

export async function generateMetadata({ params }: NotePageProps): Promise<Metadata> {
  const { key } = await params;
  const today = ownerDateKey(new Date());
  const parsed = parseNoteKey(key, today);
  const notFoundMeta = { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  if (!parsed) return notFoundMeta;
  if (parsed.kind === "daily") return { title: `${dailyTitle(parsed.day, today)} · brahua-os` };
  const note = await getPageNote(parsed.id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  return note ? { title: `${note.title} · brahua-os` } : notFoundMeta;
}

/**
 * A note's page (SPEC-notes "Pantallas"). `key` is a day (`YYYY-MM-DD`: the daily note; a future or
 * malformed day is a 404, a day without a note opens empty, in the editor) or a knowledge note's id
 * (missing or deleted: 404). The saved body is rendered here, on the server; the editor saves on
 * its own. One instant for the page (Lima's today).
 */
export default async function NotePage({ params }: NotePageProps) {
  await requireOwner();
  const { key } = await params;
  const today = ownerDateKey(new Date());
  const parsed = parseNoteKey(key, today);
  if (!parsed) notFound();
  const cookieStore = await cookies();
  const shortcuts = areShortcutsEnabled(cookieStore.get(SHORTCUTS_COOKIE)?.value);

  const [note, areas] = await Promise.all([
    parsed.kind === "daily" ? getDailyNote(parsed.day) : getPageNote(parsed.id),
    parsed.kind === "page" ? listNoteAreas() : Promise.resolve([]),
  ]);
  if (parsed.kind === "page" && !note) {
    // A daily note's id (a `[[note:…]]` link drawn without the server's resolution): its day.
    const linkedDay = await getDailyNoteDay(parsed.id);
    if (linkedDay) redirect(notePath(linkedDay));
    notFound();
  }

  const body = note?.body ?? "";
  const day = parsed.kind === "daily" ? parsed.day : null;
  // N2: what the links point to now (one query per type present) and the notes linking here.
  const [noteLinks, linkedFrom] = await Promise.all([
    getNoteLinkResolutions(NOTE_LINK_SOURCES, body),
    note ? getLinkedFrom(note.id) : Promise.resolve([]),
  ]);

  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={NOTES_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToList}
        </Link>
        {/* One reading width for the whole note: header, body and the slots of N2 and N3. */}
        <article
          className="flex w-full max-w-192 min-w-0 flex-col gap-6"
          data-note-kind={parsed.kind}
        >
          {day !== null ? (
            <DailyNoteHeader key={day} day={day} today={today} headingId={HEADING_ID} />
          ) : note ? (
            <PageNoteHeader note={note} areas={areas} headingId={HEADING_ID} />
          ) : null}
          <NoteBody
            // A new day or note is a new editor (its own text, version and timers).
            // (Prefixed: the day header is a sibling keyed by the same day.)
            key={`body:${day ?? note?.id}`}
            note={{ id: note?.id ?? null, body, version: note?.version ?? 0 }}
            day={day}
            rendered={
              body ? (
                // Resolved for exactly this text: a link the server didn't find is gone.
                <Markdown
                  headingOffset={HEADING_OFFSET}
                  noteLinks={noteLinks}
                  unknownNoteLinks="deleted"
                >
                  {body}
                </Markdown>
              ) : null
            }
            noteLinks={noteLinks}
            searchLinks={searchNoteLinks}
            shortcuts={shortcuts}
            linkedFrom={
              <NoteBacklinks
                title={COPY.linkedFromTitle}
                notes={linkedFrom}
                headingId="note-linked-from-title"
                marker="note-linked-from"
              />
            }
            // N3 fills `dayFooter` («Ese día») here.
          />
        </article>
      </div>
    </ScreenServicesProvider>
  );
}
