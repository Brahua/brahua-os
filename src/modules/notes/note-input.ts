// Validation and shapes of `notes` (N1). Client-safe: the editor and the sheets run the same
// schemas before sending, and the server actions are the authority. The body's sanitation is the
// one projects' and tasks' notes use (src/lib/markdown-text.ts) with the notes' own limit.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system";
import { hasControlCharacters, markdownTextSchema } from "@/lib/markdown-text";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { NOTES_ERRORS } from "./copy";
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_CAPTURE_MAX_LENGTH,
  NOTE_LINK_QUERY_MAX_LENGTH,
  NOTE_TASK_ITEMS_MAX,
  NOTE_TITLE_MAX_LENGTH,
  type NoteKind,
} from "./note-constants";
import { isDayKey } from "./note-day";

const id = z.uuid({ error: NOTES_ERRORS.notFound });

/** A note's body as stored: NFC, `\n`, no leading blank lines or trailing spaces, ≤ 50 000. */
export const noteBodySchema = markdownTextSchema(NOTE_BODY_MAX_LENGTH, NOTES_ERRORS.body, {
  // A note's body is always text: null is refused, never read as «empty it».
  nullable: false,
});

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
  // Postgres' integer is the ceiling: a larger number would fail the query instead of being refused.
  version: z
    .int({ error: NOTES_ERRORS.version })
    .min(1, NOTES_ERRORS.version)
    .max(2_147_483_647, NOTES_ERRORS.version),
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

/**
 * The `[[` picker's search (N2): the text typed after `[[`, at most 80 characters. Control
 * characters become spaces (Postgres refuses NUL in a parameter).
 */
export const searchNoteLinksInputSchema = z.object({
  q: z
    .string()
    .max(NOTE_LINK_QUERY_MAX_LENGTH)
    .transform((value) => value.replace(/\p{Cc}/gu, " ")),
});
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

// ---------------------------------------------------------------------------------------------
// N3: a line turned into a task, and the quick capture «Nota».

const version = z
  .int({ error: NOTES_ERRORS.version })
  .min(1, NOTES_ERRORS.version)
  .max(2_147_483_647, NOTES_ERRORS.version);

/** One line of a note as the screen read it: no line breaks or control characters. */
const lineText = z
  .string({ error: NOTES_ERRORS.version })
  .max(NOTE_BODY_MAX_LENGTH, NOTES_ERRORS.version)
  .refine((value) => !/[\r\n]/.test(value) && !hasControlCharacters(value), NOTES_ERRORS.version);

/**
 * «Convertir en tarea»: the note, the version the screen showed, the item's index among the task
 * items and its text (both must still match, SPEC-notes "Línea → tarea").
 */
export const convertLineInputSchema = z.object({
  noteId: id,
  version,
  index: z
    .int({ error: NOTES_ERRORS.version })
    .min(0, NOTES_ERRORS.version)
    .max(NOTE_TASK_ITEMS_MAX, NOTES_ERRORS.version),
  text: lineText.refine((value) => value.trim() !== "", NOTES_ERRORS.version),
});
export type ConvertLineInput = z.output<typeof convertLineInputSchema>;

/**
 * «Deshacer» of a conversion: what the conversion left (the version, the task and its line) and
 * the line as it was before.
 */
export const undoConvertLineInputSchema = z.object({
  noteId: id,
  version,
  taskId: z.uuid({ error: NOTES_ERRORS.version }),
  line: z
    .int({ error: NOTES_ERRORS.version })
    .min(0, NOTES_ERRORS.version)
    .max(NOTE_BODY_MAX_LENGTH, NOTES_ERRORS.version),
  original: lineText,
});
export type UndoConvertLineInput = z.output<typeof undoConvertLineInputSchema>;

/**
 * The quick capture's text: one line (runs of whitespace, line breaks included, as one space),
 * 1–500 characters, no invisible or control characters.
 */
export const captureTextSchema = z
  .string({ error: NOTES_ERRORS.captureEmpty })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, NOTES_ERRORS.captureEmpty)
      .max(NOTE_CAPTURE_MAX_LENGTH, NOTES_ERRORS.captureTooLong)
      .refine((value) => !hasInvisibleCharacters(value), NOTES_ERRORS.captureInvisible),
  );

export const captureNoteInputSchema = z.object({ text: captureTextSchema });
export type CaptureNoteInput = z.output<typeof captureNoteInputSchema>;

/** What a capture appended: `- HH:MM texto`, after a line break when the note had text. */
const APPENDED = new RegExp(`^\\n?- \\d{2}:\\d{2} [^\\r\\n]{1,${NOTE_CAPTURE_MAX_LENGTH}}$`);

/** «Deshacer» of a capture: the note, the version it left and exactly what it appended. */
export const undoCaptureInputSchema = z.object({
  noteId: id,
  version,
  appended: z
    .string({ error: NOTES_ERRORS.version })
    .refine((value) => APPENDED.test(value), NOTES_ERRORS.version),
});
export type UndoCaptureInput = z.output<typeof undoCaptureInputSchema>;

/** A line turned into a task: the note as it is now and what «Deshacer» needs. */
export type ConvertedLine = {
  noteId: string;
  version: number;
  body: string;
  taskId: string;
  /** The task's title (as stored). */
  title: string;
  /** The line that changed (0-based) and what it held before. */
  line: number;
  original: string;
};

/** A task after the live checkbox (or its notice's «Deshacer»), and what the notice says. */
export type NoteTaskToggled = { id: string; title: string; done: boolean; notice: string };

/** A note after an undo: its new version and body. */
export type RestoredLine = { noteId: string; version: number; body: string };

/** A capture: today's note (created or not), the version it left and what it appended. */
export type CapturedLine = {
  noteId: string;
  day: string;
  version: number;
  appended: string;
  created: boolean;
};
