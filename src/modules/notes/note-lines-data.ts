// N3 data access of `notes` (server only): a line turned into a task and its «Deshacer», and the
// quick capture «Nota» and its «Deshacer». These functions take the database and trust their
// input: the actions check the owner and validate first. Nothing here logs a note's text.
//
// Locks (notes.ts has the rules):
// - The capture may create today's note, so `(9000, hashtext('notes:daily:' || day))` is its FIRST
//   lock; then the note's row FOR UPDATE. Two captures at once wait for each other and both lines
//   land (neither overwrites the other).
// - Converting a line and the two «Deshacer» only change a note that exists: no advisory lock.
//   The note's row FOR UPDATE, then the version decides (a save or capture since then is
//   «Cambió mientras tanto», nothing written). The task's writes (`NoteTaskWriter`, from `tasks`
//   through src/lib/note-task-actions.ts) run inside the same transaction and take no advisory
//   lock either (an inbox task belongs to no project).
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { notes } from "./db/schema";
import type { NoteFailure } from "./copy";
import { NOTE_BODY_MAX_LENGTH } from "./note-constants";
import type {
  CapturedLine,
  CaptureNoteInput,
  ConvertedLine,
  ConvertLineInput,
  RestoredLine,
  UndoCaptureInput,
  UndoConvertLineInput,
} from "./note-input";
import {
  appendLine,
  captureLine,
  convertTaskItem,
  findConvertibleItem,
  lineAt,
  removeAppended,
  restoreTaskItem,
} from "./note-lines";
import { lockDay, type Tx } from "./notes";

/**
 * What `notes` needs from `tasks` to turn a line into a task (SPEC-notes "Contratos → notes →
 * tasks"), inside the note's transaction. `notes` never imports `tasks`: the composition root
 * passes these in.
 */
export type NoteTaskWriter = {
  /** A pending inbox task titled `text` (never cut, no date read), or why it can't be one. */
  create(
    tx: Tx,
    text: string,
  ): Promise<{ id: string; title: string } | { problem: "empty" | "tooLong" | "invisible" }>;
  /** Soft-deletes the task only if untouched since it was created. */
  undo(tx: Tx, id: string): Promise<"removed" | "kept" | "missing">;
};

const TITLE_PROBLEM: Record<"empty" | "tooLong" | "invisible", NoteFailure> = {
  empty: "lineEmpty",
  tooLong: "lineTooLong",
  invisible: "lineInvisible",
};

/** A uuid-shaped stand-in, to measure the converted body before the task exists. */
const SAMPLE_ID = "00000000-0000-0000-0000-000000000000";

const live = isNull(notes.deletedAt);

/** A live note's body and version, its row locked until the transaction ends. */
async function lockNote(tx: Tx, id: string) {
  const [note] = await tx
    .select({ id: notes.id, body: notes.body, version: notes.version })
    .from(notes)
    .where(and(eq(notes.id, id), live))
    .for("update");
  return note ?? null;
}

/** Writes a new body and bumps the version (the row is locked by the caller). */
async function writeBody(tx: Tx, id: string, body: string) {
  const [saved] = await tx
    .update(notes)
    .set({ body, version: sql`${notes.version} + 1`, updatedAt: sql`now()` })
    .where(eq(notes.id, id))
    .returning({ version: notes.version, body: notes.body });
  return saved;
}

/**
 * «Convertir en tarea» (SPEC-notes "Línea → tarea"): in one transaction, checks the note is still
 * at `version` and its task item `index` still reads `text`, creates the inbox task and replaces
 * the line with `[[task:<id>|texto]]`. Anything else writes nothing: `changed` (the note moved on),
 * `notFound`, the title's problem, or `bodyFull` (the link doesn't fit in 50 000).
 */
export async function convertNoteLine(
  db: Database,
  { noteId, version, index, text }: ConvertLineInput,
  writer: NoteTaskWriter,
): Promise<ConvertedLine | NoteFailure> {
  return db.transaction(async (tx) => {
    const note = await lockNote(tx, noteId);
    if (!note) return "notFound";
    if (note.version !== version) return "changed";
    const item = findConvertibleItem(note.body, index, text);
    if (!item?.text) return "changed";
    // Measured first: once the task is inserted, returning would commit it.
    const measured = convertTaskItem(note.body, item, SAMPLE_ID);
    if (measured === null) return "changed";
    if (measured.length > NOTE_BODY_MAX_LENGTH) return "bodyFull";
    const created = await writer.create(tx, item.text);
    if ("problem" in created) return TITLE_PROBLEM[created.problem];
    const body = convertTaskItem(note.body, item, created.id);
    if (body === null) throw new Error("convertNoteLine: the measured line stopped matching");
    const saved = await writeBody(tx, noteId, body);
    return {
      noteId,
      version: saved.version,
      body: saved.body,
      taskId: created.id,
      title: created.title,
      line: item.line,
      original: lineAt(note.body, item.line) ?? "",
    };
  });
}

/**
 * «Deshacer» of a conversion: only if the note is still at the version the conversion left
 * (`changed` otherwise) and the task is untouched (`taskChanged` otherwise: it is the owner's now,
 * and both stay). The task is soft-deleted and the line is the original again. A task that is
 * already gone (deleted from Tareas) just lets the line come back.
 */
export async function undoNoteLineConversion(
  db: Database,
  { noteId, version, taskId, line, original }: UndoConvertLineInput,
  writer: NoteTaskWriter,
): Promise<RestoredLine | NoteFailure> {
  return db.transaction(async (tx) => {
    const note = await lockNote(tx, noteId);
    if (!note) return "notFound";
    if (note.version !== version) return "changed";
    const body = restoreTaskItem(note.body, line, taskId, original);
    if (body === null) return "changed";
    // Checked before writing the note: a task that changed keeps everything as it is.
    if ((await writer.undo(tx, taskId)) === "kept") return "taskChanged";
    const saved = await writeBody(tx, noteId, body);
    return { noteId, version: saved.version, body: saved.body };
  });
}

/**
 * The quick capture «Nota» (SPEC-notes "Captura «Nota»"): `- HH:MM texto` (Lima's clock at `now`)
 * at the end of today's note, created if the day has none. Under the day's lock (the first one),
 * so two captures at once leave two lines. `bodyFull` when it doesn't fit (nothing written).
 */
export async function appendToDailyNote(
  db: Database,
  { text }: CaptureNoteInput,
  now: Date,
): Promise<CapturedLine | NoteFailure> {
  const day = ownerDateKey(now);
  const line = captureLine(now, text);
  return db.transaction(async (tx) => {
    await lockDay(tx, day);
    const [note] = await tx
      .select({ id: notes.id, body: notes.body })
      .from(notes)
      .where(and(eq(notes.kind, "daily"), eq(notes.day, day), live))
      .for("update");
    if (!note) {
      const [created] = await tx
        .insert(notes)
        .values({ kind: "daily", day, body: line })
        .returning({ id: notes.id, version: notes.version });
      return { noteId: created.id, day, version: created.version, appended: line, created: true };
    }
    const next = appendLine(note.body, line);
    if (next.body.length > NOTE_BODY_MAX_LENGTH) return "bodyFull";
    const saved = await writeBody(tx, note.id, next.body);
    return {
      noteId: note.id,
      day,
      version: saved.version,
      appended: next.appended,
      created: false,
    };
  });
}

/**
 * «Deshacer» of a capture: removes exactly what it appended, only if the note is still at the
 * version it left (`changed` otherwise). A note the capture created stays, empty (decisión
 * autónoma para revisar con el owner: deleting it could race a first save of the editor; an empty
 * daily note reads «Sin texto todavía» in the list and keeps «Nota de hoy» on Hoy).
 */
export async function undoDailyNoteAppend(
  db: Database,
  { noteId, version, appended }: UndoCaptureInput,
): Promise<{ noteId: string; version: number } | NoteFailure> {
  return db.transaction(async (tx) => {
    const note = await lockNote(tx, noteId);
    if (!note) return "notFound";
    if (note.version !== version) return "changed";
    const body = removeAppended(note.body, appended);
    if (body === null) return "changed";
    const saved = await writeBody(tx, noteId, body);
    return { noteId, version: saved.version };
  });
}
