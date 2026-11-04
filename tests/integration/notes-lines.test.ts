// N3 of `notes` against the throwaway database: «Convertir en tarea» (the inbox task and the line
// in one transaction, «Cambió mientras tanto» for an old version or another item, a title too long
// or a note too full write nothing) and its exact «Deshacer» (only at the version it left, only an
// untouched task); the live checkbox through `tasks`' own completion (recurrence included); the
// quick capture «Nota» (creates today's note, appends after a line break, two at once leave two
// lines, the day's lock first, a deleted note doesn't block, an editor with the old version gets
// the conflict) and its «Deshacer»; «Ese día»'s counts (Lima's day, recurrence, deleted rows out,
// habits by their own log); and the authorization of every action and read.
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { getDayFooterSlot } from "@/lib/note-extensions";
import {
  completeNoteTask,
  convertNoteLineToTask,
  reopenNoteTask,
  undoNoteLineToTask,
} from "@/lib/note-task-actions";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { countHabitsDoneOn } from "@/modules/habits/note-day-count";
import {
  captureNote,
  deleteNote,
  saveDailyNote,
  saveNote,
  undoCaptureNote,
} from "@/modules/notes/actions";
import { NOTES_ERRORS } from "@/modules/notes/copy";
import { notes } from "@/modules/notes/db/schema";
import { dailyNoteLockKey, NOTES_ADVISORY_SPACE } from "@/modules/notes/lock-keys";
import { addDays } from "@/modules/notes/note-day";
import type { CapturedLine, ConvertedLine } from "@/modules/notes/note-input";
import { projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { countTasksCompletedOn } from "@/modules/tasks/note-tasks";
import { completeTaskById } from "@/modules/tasks/tasks";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const TODAY = ownerDateKey(new Date());
const YESTERDAY = addDays(TODAY, -1);
const BODY = "Pendientes:\n\n- [ ] Llamar al banco\n- [ ] Pagar la luz mañana";

/** A daily note of `day` with `body`, at version 1. */
async function dailyNote(day: string, body: string): Promise<string> {
  const result = await saveDailyNote({ day, body });
  if (!result.ok || result.data.status !== "saved") {
    throw new Error(`saveDailyNote failed: ${JSON.stringify(result)}`);
  }
  return result.data.id;
}

const noteRow = async (id: string) =>
  (await testDb.select().from(notes).where(eq(notes.id, id)))[0];
const taskRow = async (id: string) =>
  (await testDb.select().from(tasks).where(eq(tasks.id, id)))[0];
const allTasks = () => testDb.select().from(tasks);

async function convert(noteId: string, version: number, index: number, text: string) {
  return convertNoteLineToTask({ noteId, version, index, text });
}

async function converted(noteId: string, version = 1): Promise<ConvertedLine> {
  const result = await convert(noteId, version, 0, "Llamar al banco");
  if (!result.ok) throw new Error(`convert failed: ${JSON.stringify(result)}`);
  return result.data;
}

const undoOf = (line: ConvertedLine) => ({
  noteId: line.noteId,
  version: line.version,
  taskId: line.taskId,
  line: line.line,
  original: line.original,
});

describe("«Convertir en tarea»", () => {
  test("the task lands in the inbox as written (no date read) and the line becomes its link", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    const result = await convert(id, 1, 1, "Pagar la luz mañana");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = await taskRow(result.data.taskId);
    expect(task).toMatchObject({
      title: "Pagar la luz mañana",
      dueDate: null,
      lifeAreaId: null,
      projectId: null,
      doneAt: null,
      deletedAt: null,
      priority: "medium",
    });
    const expected = `Pendientes:\n\n- [ ] Llamar al banco\n- [[task:${task.id}|Pagar la luz mañana]]`;
    expect(result.data).toMatchObject({
      noteId: id,
      version: 2,
      body: expected,
      line: 3,
      original: "- [ ] Pagar la luz mañana",
    });
    expect(await noteRow(id)).toMatchObject({ body: expected, version: 2 });
    // The notes pages and the task lists are read again.
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(["/notes", "/tasks", "/"]));
  });

  test("an old version, another index or another text: «Cambió mientras tanto», nothing written", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    for (const [version, index, text] of [
      [2, 0, "Llamar al banco"],
      [1, 1, "Llamar al banco"],
      [1, 0, "Llamar al bancos"],
      [1, 5, "Llamar al banco"],
    ] as const) {
      expect(await convert(id, version, index, text)).toEqual({
        ok: false,
        error: NOTES_ERRORS.changed,
      });
    }
    expect(await allTasks()).toHaveLength(0);
    expect(await noteRow(id)).toMatchObject({ body: BODY, version: 1 });
    // Positive control: the right version, index and text convert.
    expect((await convert(id, 1, 0, "Llamar al banco")).ok).toBe(true);
    // And a line that is already a link can't be converted again.
    expect((await convert(id, 2, 0, "Llamar al banco")).ok).toBe(false);
    expect(await allTasks()).toHaveLength(1);
  });

  test("a line longer than a task's title, or a note with no room for the link: refused, nothing written", async () => {
    const long = "x".repeat(201);
    const id = await dailyNote(YESTERDAY, `- [ ] ${long}`);
    expect(await convert(id, 1, 0, long)).toEqual({ ok: false, error: NOTES_ERRORS.lineTooLong });
    // Exactly 200 fits (positive control).
    const fits = await dailyNote(addDays(TODAY, -2), `- [ ] ${"y".repeat(200)}`);
    expect((await convert(fits, 1, 0, "y".repeat(200))).ok).toBe(true);
    expect(await allTasks()).toHaveLength(1);

    const full = await dailyNote(addDays(TODAY, -3), `${"z".repeat(49_980)}\n\n- [ ] Una`);
    expect(await convert(full, 1, 0, "Una")).toEqual({ ok: false, error: NOTES_ERRORS.bodyFull });
    expect(await allTasks()).toHaveLength(1);
    expect((await noteRow(full)).version).toBe(1);
  });

  test("a deleted note is not found", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    await deleteNote({ id });
    expect(await convert(id, 1, 0, "Llamar al banco")).toEqual({
      ok: false,
      error: NOTES_ERRORS.notFound,
    });
    expect(await allTasks()).toHaveLength(0);
  });
});

describe("«Deshacer» of a conversion", () => {
  test("exact: the untouched task is soft-deleted and the line comes back as it was", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    const line = await converted(id);
    const undone = await undoNoteLineToTask(undoOf(line));
    expect(undone).toEqual({ ok: true, data: { noteId: id, version: 3, body: BODY } });
    expect(await noteRow(id)).toMatchObject({ body: BODY, version: 3 });
    expect((await taskRow(line.taskId)).deletedAt).not.toBeNull();
    // Twice: the note moved on («Cambió mientras tanto»).
    expect(await undoNoteLineToTask(undoOf(line))).toEqual({
      ok: false,
      error: NOTES_ERRORS.changed,
    });
  });

  test("a note saved since: «Cambió mientras tanto», the task and the link stay", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    const line = await converted(id);
    expect((await saveNote({ id, body: `${line.body}\nmás`, version: line.version })).ok).toBe(
      true,
    );
    expect(await undoNoteLineToTask(undoOf(line))).toEqual({
      ok: false,
      error: NOTES_ERRORS.changed,
    });
    expect((await taskRow(line.taskId)).deletedAt).toBeNull();
    expect((await noteRow(id)).body).toBe(`${line.body}\nmás`);
  });

  test("a task completed or edited since stays, and so does the line (taskChanged)", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    const line = await converted(id);
    expect((await completeNoteTask({ id: line.taskId })).ok).toBe(true);
    expect(await undoNoteLineToTask(undoOf(line))).toEqual({
      ok: false,
      error: NOTES_ERRORS.taskChanged,
    });
    expect(await taskRow(line.taskId)).toMatchObject({ deletedAt: null });
    expect((await taskRow(line.taskId)).doneAt).not.toBeNull();
    expect(await noteRow(id)).toMatchObject({ body: line.body, version: line.version });

    // Edited (a title change stamps updated_at), then reopened: still the owner's.
    const other = await dailyNote(addDays(TODAY, -2), BODY);
    const second = await converted(other);
    await testDb
      .update(tasks)
      .set({ title: "Llamar al banco hoy" })
      .where(eq(tasks.id, second.taskId));
    expect((await undoNoteLineToTask(undoOf(second))).ok).toBe(false);
    expect((await taskRow(second.taskId)).deletedAt).toBeNull();
  });

  test("a task deleted from Tareas meanwhile: the line still comes back", async () => {
    const id = await dailyNote(YESTERDAY, BODY);
    const line = await converted(id);
    await testDb.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, line.taskId));
    expect((await undoNoteLineToTask(undoOf(line))).ok).toBe(true);
    expect((await noteRow(id)).body).toBe(BODY);
  });
});

describe("the live checkbox", () => {
  test("marks the task done and back with `tasks`' own completion; a recurring one creates its next", async () => {
    const [task] = await testDb
      .insert(tasks)
      .values({ title: "Regar", recurrenceKind: "every_days", recurrenceInterval: 2 })
      .returning();
    const done = await completeNoteTask({ id: task.id });
    expect(done).toMatchObject({ ok: true, data: { id: task.id, done: true } });
    if (done.ok) expect(done.data.notice).toMatch(/^«Regar» está hecha\. La siguiente vence el /);
    const live = await testDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.spawnedFromId, task.id), isNull(tasks.deletedAt)));
    expect(live).toHaveLength(1);
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toContain("/notes");

    const reopened = await reopenNoteTask({ id: task.id });
    expect(reopened).toMatchObject({ ok: true, data: { done: false } });
    if (reopened.ok) expect(reopened.data.notice).toMatch(/se quitó la siguiente/);
    expect((await taskRow(task.id)).doneAt).toBeNull();
    expect((await taskRow(live[0].id)).deletedAt).not.toBeNull();
  });

  test("a deleted task is refused (its box isn't drawn anyway)", async () => {
    const [task] = await testDb
      .insert(tasks)
      .values({ title: "Borrada", deletedAt: new Date() })
      .returning();
    expect((await completeNoteTask({ id: task.id })).ok).toBe(false);
  });
});

describe("the quick capture «Nota»", () => {
  const LINE = /^- \d{2}:\d{2} /;

  async function capture(text: string): Promise<CapturedLine> {
    const result = await captureNote({ text });
    if (!result.ok) throw new Error(`captureNote failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  test("creates today's note, then appends after a line break; Hoy and the notes are read again", async () => {
    const first = await capture("  idea: comparar Neon\ncon Supabase ");
    expect(first).toMatchObject({ day: TODAY, version: 1, created: true });
    const created = await noteRow(first.noteId);
    expect(created).toMatchObject({ kind: "daily", day: TODAY, version: 1 });
    expect(created.body).toMatch(new RegExp(`${LINE.source}idea: comparar Neon con Supabase$`));
    expect(first.appended).toBe(created.body);

    const second = await capture("otra");
    expect(second).toMatchObject({ noteId: first.noteId, version: 2, created: false });
    expect(second.appended).toMatch(/^\n- \d{2}:\d{2} otra$/);
    expect((await noteRow(first.noteId)).body).toBe(`${created.body}${second.appended}`);
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(["/notes", "/"]));
  });

  test("two captures at once leave two lines in one note", async () => {
    await Promise.all([capture("una"), capture("dos")]);
    const rows = await testDb.select().from(notes);
    expect(rows).toHaveLength(1);
    const lines = rows[0].body.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.replace(LINE, "")).sort()).toEqual(["dos", "una"]);
    expect(rows[0].version).toBe(2);
  });

  test("it waits for the day's lock (taken first); another day's first save doesn't", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        NOTES_ADVISORY_SPACE,
        dailyNoteLockKey(TODAY),
      ]);
      let settled = false;
      const blocked = captureNote({ text: "espera" }).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      // Positive control: yesterday's lock is free.
      expect((await saveDailyNote({ day: YESTERDAY, body: "Ayer" })).ok).toBe(true);
      await holder.query("commit");
      expect((await blocked).ok).toBe(true);
    } finally {
      holder.release();
    }
  });

  test("a deleted note of today doesn't block: a new one is created, the deleted one untouched", async () => {
    const old = await dailyNote(TODAY, "Vieja");
    await deleteNote({ id: old });
    const line = await capture("nueva");
    expect(line.created).toBe(true);
    expect(line.noteId).not.toBe(old);
    expect(await noteRow(old)).toMatchObject({ body: "Vieja", version: 1 });
  });

  test("an editor with the old version gets the conflict, never overwrites the line", async () => {
    const id = await dailyNote(TODAY, "Escribiendo");
    const line = await capture("desde la calle");
    const save = await saveNote({ id, body: "Escribiendo más", version: 1 });
    expect(save).toMatchObject({
      ok: true,
      data: { status: "conflict", current: { version: line.version } },
    });
    expect((await noteRow(id)).body).toBe(`Escribiendo${line.appended}`);
  });

  test("a note with no room: refused, nothing written", async () => {
    const id = await dailyNote(TODAY, "x".repeat(49_990));
    const result = await captureNote({ text: "no cabe" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { text: [NOTES_ERRORS.bodyFull] } });
    expect((await noteRow(id)).version).toBe(1);
  });

  test("«Deshacer» removes exactly the line, only at the version it left", async () => {
    const id = await dailyNote(TODAY, "Mañana:");
    const line = await capture("idea");
    expect(await undoCaptureNote(line)).toEqual({ ok: true, data: { noteId: id, version: 3 } });
    expect(await noteRow(id)).toMatchObject({ body: "Mañana:", version: 3 });

    const again = await capture("otra");
    expect((await saveNote({ id, body: "Cambiado", version: again.version })).ok).toBe(true);
    expect(await undoCaptureNote(again)).toEqual({ ok: false, error: NOTES_ERRORS.changed });
    expect((await noteRow(id)).body).toBe("Cambiado");
  });

  test("«Deshacer» of the capture that created the note leaves it empty (never deleted)", async () => {
    const line = await capture("primera");
    expect((await undoCaptureNote(line)).ok).toBe(true);
    expect(await noteRow(line.noteId)).toMatchObject({ body: "", version: 2, deletedAt: null });
  });

  test("the input is checked on the server too", async () => {
    expect(await captureNote({ text: "   " })).toMatchObject({ ok: false });
    expect(await captureNote({ text: "a".repeat(501) })).toMatchObject({ ok: false });
    expect(await captureNote({ text: "nul\u0000" })).toMatchObject({ ok: false });
    expect(
      await undoCaptureNote({ noteId: crypto.randomUUID(), version: 1, appended: "Hola" }),
    ).toMatchObject({ ok: false });
    expect(await testDb.select().from(notes)).toHaveLength(0);
  });
});

describe("«Ese día»", () => {
  const DAY = "2026-10-02";
  // Lima's 2 Oct starts at 05:00 UTC on the 2nd and ends a second before 05:00 UTC on the 3rd.
  const FIRST_SECOND = new Date("2026-10-02T05:00:00Z");
  const LAST_SECOND = new Date("2026-10-03T04:59:59Z");

  test("tasks completed that Lima day: edges, recurrence, deleted ones out", async () => {
    const [home] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));
    const [gone] = await testDb
      .insert(projects)
      .values({ name: "Borrado", lifeAreaId: home.id, status: "active", deletedAt: new Date() })
      .returning();
    await testDb
      .insert(tasks)
      .values([
        { title: "primer segundo", doneAt: FIRST_SECOND },
        { title: "último segundo", doneAt: LAST_SECOND },
        { title: "día anterior", doneAt: new Date("2026-10-02T04:59:59Z") },
        { title: "día siguiente", doneAt: new Date("2026-10-03T05:00:00Z") },
        { title: "eliminada", doneAt: FIRST_SECOND, deletedAt: new Date() },
        { title: "de un proyecto eliminado", doneAt: FIRST_SECOND, projectId: gone.id },
        { title: "pendiente" },
      ]);
    expect(await countTasksCompletedOn(testDb, DAY)).toBe(2);

    // A recurring task completed now counts once; its next occurrence is pending.
    const [recurring] = await testDb
      .insert(tasks)
      .values({ title: "Regar", recurrenceKind: "every_days", recurrenceInterval: 1 })
      .returning();
    await completeTaskById(testDb, recurring.id);
    expect(await countTasksCompletedOn(testDb, TODAY)).toBe(1);
  });

  test("habits met that day by their own log; never avoid habits, deleted ones or other days", async () => {
    const base = { frequency: "daily", startDate: "2026-09-01" } as const;
    const check = { ...base, measure: "check" } as const;
    const quantity = { ...base, measure: "quantity", goal: 8, unit: "vasos", step: 1 } as const;
    const [meditar, leer, agua, poca, evitar, archivado, borrado] = await testDb
      .insert(habits)
      .values([
        { ...check, name: "Meditar", sortOrder: 0 },
        { ...check, name: "Leer", sortOrder: 1 },
        { ...quantity, name: "Agua", sortOrder: 2 },
        { ...quantity, name: "Poca agua", sortOrder: 3 },
        { ...check, name: "No fumar", kind: "avoid", sortOrder: 4 },
        { ...check, name: "Archivado", sortOrder: 5, archivedAt: new Date() },
        { ...check, name: "Borrado", sortOrder: 6, deletedAt: new Date() },
      ])
      .returning();
    await testDb.insert(habitLogs).values([
      { habitId: meditar.id, day: DAY, quantity: 1, target: 1 },
      { habitId: leer.id, day: DAY, quantity: 0, target: 1 },
      { habitId: agua.id, day: DAY, quantity: 9, target: 8 },
      { habitId: poca.id, day: DAY, quantity: 5, target: 8 },
      { habitId: evitar.id, day: DAY, quantity: 1, target: 1 },
      { habitId: archivado.id, day: DAY, quantity: 1, target: 1 },
      { habitId: borrado.id, day: DAY, quantity: 1, target: 1 },
      { habitId: leer.id, day: "2026-10-01", quantity: 1, target: 1 },
    ]);
    // Meditar, Agua (9/8) and the archived one.
    expect(await countHabitsDoneOn(testDb, DAY)).toBe(3);
    expect(await countHabitsDoneOn(testDb, "2026-10-01")).toBe(1);
    expect(await countHabitsDoneOn(testDb, "2026-10-03")).toBe(0);
  });

  test("the footer's root reads both counts for the owner", async () => {
    await testDb.insert(tasks).values({ title: "hecha", doneAt: FIRST_SECOND });
    const slot = (await getDayFooterSlot(DAY)) as ReactElement<{
      tasksDone: number;
      habitsDone: number;
    }>;
    expect(slot.props).toEqual({ tasksDone: 1, habitsDone: 0 });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every N3 action is refused and «Ese día» redirects", async (_, headers) => {
    const id = await dailyNote(YESTERDAY, BODY);
    const line = await converted(id);
    request.headers = await headers();
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await convert(id, 2, 0, "Pagar la luz mañana")).toEqual(refused);
    expect(await undoNoteLineToTask(undoOf(line))).toEqual(refused);
    expect(await completeNoteTask({ id: line.taskId })).toEqual(refused);
    expect(await reopenNoteTask({ id: line.taskId })).toEqual(refused);
    expect(await captureNote({ text: "intruso" })).toEqual(refused);
    expect(await undoCaptureNote({ noteId: id, version: 2, appended: "- 10:00 intruso" })).toEqual(
      refused,
    );
    await expect(getDayFooterSlot(YESTERDAY)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    // Nothing moved.
    expect(await noteRow(id)).toMatchObject({ body: line.body, version: 2 });
    expect(await taskRow(line.taskId)).toMatchObject({ doneAt: null, deletedAt: null });
    expect(await allTasks()).toHaveLength(1);
    expect(await testDb.select().from(notes)).toHaveLength(1);
  });
});
