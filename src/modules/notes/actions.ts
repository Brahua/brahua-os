"use server";

// Server Actions of `notes` (N1): saving the body (the autosave), «Nueva nota», title, area, pin,
// delete and its «Deshacer». Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`. A
// failure is logged by ownerAction with `describeError` only: never a note's title or body.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { NOTES_ERRORS, type NoteFailure } from "./copy";
import {
  createNoteInputSchema,
  noteIdInputSchema,
  pinNoteInputSchema,
  renameNoteInputSchema,
  saveDailyNoteInputSchema,
  saveNoteInputSchema,
  setNoteAreaInputSchema,
  type DeletedNote,
  type NoteItem,
  type SaveResult,
} from "./note-input";
import { isWritableDay } from "./note-day";
import {
  insertPageNote,
  renamePageNote,
  restoreNoteById,
  saveDailyNoteBody,
  saveNoteBody,
  setPageNoteArea,
  setPageNotePinned,
  softDeleteNote,
} from "./notes";
import { revalidateNoteLists, revalidateNotes } from "./revalidate";

/** A refusal: on its field when it has one, else the general message. */
function refused<T>(failure: NoteFailure): ActionResult<T> {
  if (failure === "areaUnavailable") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { areaId: [NOTES_ERRORS.areaUnavailable] },
    };
  }
  return fail(NOTES_ERRORS[failure]);
}

/** Either way, the notes pages are read again (after a refusal they show what is there now). */
function settle<T extends object>(value: T | NoteFailure): ActionResult<T> {
  revalidateNotes();
  return typeof value === "string" ? refused<T>(value) : ok(value);
}

const saveDaily = ownerAction(
  saveDailyNoteInputSchema,
  async (data) => {
    // The server's Lima day decides: a day that hasn't come yet has no note.
    if (!isWritableDay(data.day, ownerDateKey(new Date()))) {
      return { ok: false, error: INVALID_FIELDS_MESSAGE, fieldErrors: { day: [NOTES_ERRORS.day] } };
    }
    const result = await saveDailyNoteBody(getDb(), data);
    if (result.status === "saved") revalidateNoteLists();
    return ok(result);
  },
  { name: "saveDailyNote" },
);

/**
 * The first save of a day without a note (the autosave of `/notes/<day>`): creates it under the
 * day's lock, never empty. If the day got a note meanwhile, a `conflict` with it (nothing written).
 */
export async function saveDailyNote(input: unknown): Promise<ActionResult<SaveResult>> {
  return saveDaily(input);
}

const save = ownerAction(
  saveNoteInputSchema,
  async (data) => {
    const result = await saveNoteBody(getDb(), data);
    if (result === "notFound") {
      revalidateNotes();
      return fail(NOTES_ERRORS.notFound);
    }
    if (result.status === "saved") revalidateNoteLists();
    return ok(result);
  },
  { name: "saveNote" },
);

/**
 * The autosave of a note that exists: written only if it still has `version`; else a `conflict`
 * with what is stored (SPEC-notes "Versión"). «Quedarme con la mía» sends it again with that version.
 */
export async function saveNote(input: unknown): Promise<ActionResult<SaveResult>> {
  return save(input);
}

const create = ownerAction(
  createNoteInputSchema,
  async (data) => settle(await insertPageNote(getDb(), data)),
  { name: "createNote" },
);

/** «Nueva nota»: a knowledge note with its title and area. The page then opens it to write. */
export async function createNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  return create(input);
}

const rename = ownerAction(
  renameNoteInputSchema,
  async (data) => settle(await renamePageNote(getDb(), data)),
  { name: "renameNote" },
);

/** A knowledge note's title, changed in place. Returns the note as it is now. */
export async function renameNote(input: unknown): Promise<ActionResult<NoteItem>> {
  return rename(input);
}

const setArea = ownerAction(
  setNoteAreaInputSchema,
  async (data) => settle(await setPageNoteArea(getDb(), data)),
  { name: "setNoteArea" },
);

/** A knowledge note's life area (null: none). */
export async function setNoteArea(input: unknown): Promise<ActionResult<NoteItem>> {
  return setArea(input);
}

const pin = ownerAction(
  pinNoteInputSchema,
  async (data) => settle(await setPageNotePinned(getDb(), data)),
  { name: "pinNote" },
);

/** «Fijar» / «Quitar de fijadas»: pinned knowledge notes go first in the list. */
export async function pinNote(input: unknown): Promise<ActionResult<NoteItem>> {
  return pin(input);
}

const remove = ownerAction(
  noteIdInputSchema,
  async ({ id }) => settle(await softDeleteNote(getDb(), id)),
  { name: "deleteNote" },
);

/** Soft delete: the note leaves every view; the list offers «Deshacer» (`restoreNote`). */
export async function deleteNote(input: unknown): Promise<ActionResult<DeletedNote>> {
  return remove(input);
}

const restore = ownerAction(
  noteIdInputSchema,
  async ({ id }) => settle(await restoreNoteById(getDb(), id)),
  { name: "restoreNote" },
);

/**
 * «Deshacer» of a deletion, by the note's id. A daily note whose day got another note meanwhile is
 * refused (`dayTaken`): two live notes of one day can't exist.
 */
export async function restoreNote(input: unknown): Promise<ActionResult<DeletedNote>> {
  return restore(input);
}
