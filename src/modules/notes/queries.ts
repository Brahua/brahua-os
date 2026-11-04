// Reads of `notes` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { NoteLinkResolutions } from "@/lib/markdown/note-links";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import type { NoteLinkSource } from "./contracts";
import { resolveLinks, selectLinkingNotes, type LinkingNote } from "./links";
import type { DeletedNote, NoteArea, NoteItem, NoteKindFilter, NoteListItem } from "./note-input";
import {
  selectDailyNote,
  selectDailyNoteDay,
  selectDeletedNote,
  selectNoteList,
  selectPageNote,
} from "./notes";

const noteId = z.uuid();

/** The list: `shown` notes of the kind and area asked for, and whether there are more. */
export async function listNotes(filter: {
  kind: NoteKindFilter;
  areaId: string | null;
  shown: number;
}): Promise<{ items: NoteListItem[]; more: boolean }> {
  await requireOwner();
  const areaId =
    filter.areaId !== null && noteId.safeParse(filter.areaId).success ? filter.areaId : null;
  return selectNoteList(getDb(), { kind: filter.kind, areaId, limit: filter.shown });
}

/** A day's live note, or null. Cached per request: the page's metadata reads it too. */
export const getDailyNote = cache(async (day: string): Promise<NoteItem | null> => {
  await requireOwner();
  return selectDailyNote(getDb(), day);
});

/**
 * A live knowledge note, or null when it doesn't exist, is deleted or the id is malformed (the page
 * is a 404). Cached per request.
 */
export const getPageNote = cache(async (id: string): Promise<NoteItem | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!noteId.safeParse(id).success) return null;
  return selectPageNote(getDb(), id);
});

/** The day of a live daily note by its id (a link to it opens its day), or null. */
export async function getDailyNoteDay(id: string): Promise<string | null> {
  await requireOwner();
  if (!noteId.safeParse(id).success) return null;
  return selectDailyNoteDay(getDb(), id);
}

/** A note just deleted from its page (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedNote(id: string): Promise<DeletedNote | null> {
  await requireOwner();
  if (!noteId.safeParse(id).success) return null;
  return selectDeletedNote(getDb(), id);
}

/**
 * What the links of `body` point to now (N2): one query per type present, through `sources` (the
 * composition root's list: `notes` doesn't import the modules it links to).
 */
export async function getNoteLinkResolutions(
  sources: readonly NoteLinkSource[],
  body: string,
): Promise<NoteLinkResolutions> {
  await requireOwner();
  return resolveLinks(getDb(), sources, body);
}

/**
 * «Enlazada desde» (N2): the other live notes whose body links to the note `id`. One query.
 */
export async function getLinkedFrom(id: string): Promise<LinkingNote[]> {
  await requireOwner();
  if (!noteId.safeParse(id).success) return [];
  return selectLinkingNotes(getDb(), "note", id, ownerDateKey(new Date()), id);
}

/** The active life areas, in their order: the ones a note can be put in. */
export async function listNoteAreas(): Promise<NoteArea[]> {
  const areas = await listLifeAreas();
  return areas.map(({ id, name, color, icon }) => ({ id, name, color, icon }));
}
