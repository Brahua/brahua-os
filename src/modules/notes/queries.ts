// Reads of `notes` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listLifeAreas } from "@/modules/core/queries";
import type { DeletedNote, NoteArea, NoteItem, NoteKindFilter, NoteListItem } from "./note-input";
import { selectDailyNote, selectDeletedNote, selectNoteList, selectPageNote } from "./notes";

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

/** A note just deleted from its page (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedNote(id: string): Promise<DeletedNote | null> {
  await requireOwner();
  if (!noteId.safeParse(id).success) return null;
  return selectDeletedNote(getDb(), id);
}

/** The active life areas, in their order: the ones a note can be put in. */
export async function listNoteAreas(): Promise<NoteArea[]> {
  const areas = await listLifeAreas();
  return areas.map(({ id, name, color, icon }) => ({ id, name, color, icon }));
}
