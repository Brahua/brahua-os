// Validation and shapes of `notes` (N1). Client-safe: the editor and the sheets run the same
// schemas before sending, and the server actions are the authority. The body's sanitation is the
// one projects' and tasks' notes use (src/lib/markdown-text.ts) with the notes' own limit.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system";
import { markdownTextSchema } from "@/lib/markdown-text";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { NOTES_ERRORS } from "./copy";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH, type NoteKind } from "./note-constants";
import { isDayKey } from "./note-day";

const id = z.uuid({ error: NOTES_ERRORS.notFound });

/** A note's body as stored: NFC, `\n`, no leading blank lines or trailing spaces, ≤ 50 000. */
export const noteBodySchema = markdownTextSchema(NOTE_BODY_MAX_LENGTH, NOTES_ERRORS.body);

/** A knowledge note's title, normalized like names: 1–120, no invisible characters. */
export const noteTitleSchema = z
  .string({ error: NOTES_ERRORS.titleRequired })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, NOTES_ERRORS.titleRequired)
      .max(NOTE_TITLE_MAX_LENGTH, NOTES_ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), NOTES_ERRORS.invisible),
  );

/** A real `YYYY-MM-DD` day. Whether it is in the future is checked against the server's today. */
const day = z.string({ error: NOTES_ERRORS.day }).refine(isDayKey, NOTES_ERRORS.day);

/** null: «Sin área». An area must be active (checked against the table). */
const areaId = z.uuid({ error: NOTES_ERRORS.area }).nullable();

/**
 * The first save of a day that has no note yet: creates it (never an empty one). If the day got a
 * note meanwhile (another tab, another device), nothing is written and the answer is a conflict
 * with that note.
 */
export const saveDailyNoteInputSchema = z.object({ day, body: noteBodySchema });
export type SaveDailyNoteInput = z.output<typeof saveDailyNoteInputSchema>;

/** A save of a note that exists: written only if it still has `version` (the one edited). */
export const saveNoteInputSchema = z.object({
  id,
  body: noteBodySchema,
  version: z.int({ error: NOTES_ERRORS.version }).min(1, NOTES_ERRORS.version),
});
export type SaveNoteInput = z.output<typeof saveNoteInputSchema>;

/** «Nueva nota»: a knowledge note with its title and, optionally, a life area. */
export const createNoteInputSchema = z.object({ title: noteTitleSchema, areaId });
export type CreateNoteInput = z.output<typeof createNoteInputSchema>;

export const renameNoteInputSchema = z.object({ id, title: noteTitleSchema });
export type RenameNoteInput = z.output<typeof renameNoteInputSchema>;

export const setNoteAreaInputSchema = z.object({ id, areaId });
export type SetNoteAreaInput = z.output<typeof setNoteAreaInputSchema>;

export const pinNoteInputSchema = z.object({ id, pinned: z.boolean() });
export type PinNoteInput = z.output<typeof pinNoteInputSchema>;

export const noteIdInputSchema = z.object({ id });
export type NoteIdInput = z.output<typeof noteIdInputSchema>;

/** The note as the server holds it after a save, or the one that won a conflict. */
export type SavedNote = { id: string; body: string; version: number };

/**
 * How a save ended. `saved`: written, with the new version. `conflict`: the note had another
 * version (or the day already had a note); nothing was written and `current` is what is stored.
 * `empty`: a day without a note and an empty body: nothing to create.
 */
export type SaveResult =
  | ({ status: "saved" } & SavedNote)
  | { status: "conflict"; current: SavedNote }
  | { status: "empty" };

/** A life area a note can be put in (or the one it keeps after being archived). */
export type NoteArea = { id: string; name: string; color: AreaColor; icon: AreaIconName };

/** A note for its page. */
export type NoteItem = {
  id: string;
  kind: NoteKind;
  /** `YYYY-MM-DD` for a daily note, else null. */
  day: string | null;
  /** A knowledge note's title, else null. */
  title: string | null;
  body: string;
  version: number;
  area: NoteArea | null;
  pinned: boolean;
};

/** A row of the list. */
export type NoteListItem = {
  id: string;
  kind: NoteKind;
  day: string | null;
  title: string | null;
  /** The first line with text, plain and short ("" when the note is empty). */
  excerpt: string;
  pinned: boolean;
  /** Lima day of the last edit (`YYYY-MM-DD`). */
  editedOn: string;
  areaName: string | null;
};

/** The list's kind filter (`?tipo=`). */
export type NoteKindFilter = "all" | NoteKind;

/** What the «Deshacer» of a deletion names. */
export type DeletedNote = { id: string; kind: NoteKind; day: string | null; title: string | null };
