"use server";

// Composition root of what the notes do with tasks (SPEC-notes "Contratos → notes → tasks", N3):
// the Server Actions behind «Convertir en tarea» (and its «Deshacer») and the live checkbox of a
// `[[task:…]]` item. `notes` never imports `tasks` (eslint.config.mjs): these actions hand the
// tasks' functions to the notes' transaction (`NoteTaskWriter`), and the note's page passes the
// actions to its editor as props. Each one goes through ownerAction() (owner first, Zod, an
// ActionResult; a failure is logged with `describeError` only, never a note's text) or wraps the
// tasks' own action, which does.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { NOTES_ERRORS } from "@/modules/notes/copy";
import {
  convertLineInputSchema,
  undoConvertLineInputSchema,
  type ConvertedLine,
  type NoteTaskToggled,
  type RestoredLine,
} from "@/modules/notes/note-input";
import {
  convertNoteLine,
  undoNoteLineConversion,
  type NoteTaskWriter,
} from "@/modules/notes/note-lines-data";
import { revalidateNotes } from "@/modules/notes/revalidate";
import { createInboxTask, undoInboxTask } from "@/modules/tasks/note-tasks";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import { completedNotice, reopenedNotice } from "@/modules/tasks/recurrence-notices";
import { revalidateTaskLists } from "@/modules/tasks/revalidate";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";

const WRITER: NoteTaskWriter = { create: createInboxTask, undo: undoInboxTask };

/** After a line changed into a task (or back): the notes pages and every list of tasks. */
function revalidateBoth() {
  revalidateNotes();
  revalidateTaskLists();
}

const convert = ownerAction(
  convertLineInputSchema,
  async (data) => {
    const result = await convertNoteLine(getDb(), data, WRITER);
    if (typeof result === "string") return fail(NOTES_ERRORS[result]);
    revalidateBoth();
    return ok(result);
  },
  { name: "convertNoteLine" },
);

/**
 * «Convertir en tarea»: the task in the inbox and the line turned into its link, in one
 * transaction, only if the note is still at the version the screen showed and the item still
 * reads the same. Returns the note as it is now and what «Deshacer» needs.
 */
export async function convertNoteLineToTask(input: unknown): Promise<ActionResult<ConvertedLine>> {
  return convert(input);
}

const undoConvert = ownerAction(
  undoConvertLineInputSchema,
  async (data) => {
    const result = await undoNoteLineConversion(getDb(), data, WRITER);
    if (typeof result === "string") return fail(NOTES_ERRORS[result]);
    revalidateBoth();
    return ok(result);
  },
  { name: "undoConvertNoteLine" },
);

/** «Deshacer» of a conversion: the line comes back and the untouched task goes. */
export async function undoNoteLineToTask(input: unknown): Promise<ActionResult<RestoredLine>> {
  return undoConvert(input);
}

/**
 * The checkbox marks the task done: `tasks`' own completion (recurrence included: the next
 * occurrence is created and the notice says when it is due).
 */
export async function completeNoteTask(input: unknown): Promise<ActionResult<NoteTaskToggled>> {
  const result = await completeTaskWithNext(input);
  if (!result.ok) return result;
  revalidateNotes();
  const { task, next, nextInbox, phase } = result.data;
  const notice = [
    completedNotice(task, next, nextInbox),
    phase ? TASKS_COPY.phaseComplete(phase.title) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return ok({ id: task.id, title: task.title, done: task.doneAt !== null, notice });
}

/**
 * The checkbox (or the notice's «Deshacer») takes a done task back: `tasks`' own undo of a
 * completion (its untouched next occurrence goes, an edited one stays, and the notice says which).
 */
export async function reopenNoteTask(input: unknown): Promise<ActionResult<NoteTaskToggled>> {
  const result = await reopenTaskWithSpawn(input);
  if (!result.ok) return result;
  revalidateNotes();
  const { task, spawn } = result.data;
  return ok({
    id: task.id,
    title: task.title,
    done: task.doneAt !== null,
    notice: reopenedNotice(task, spawn),
  });
}
