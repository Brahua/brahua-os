// N1 of `notes` against the throwaway database: the table's CHECKs with raw inserts and the
// partial unique index of the day; a day's first save (one row for two saves at once, with a
// positive control on two days, and the day's lock); the autosave with its version (an old one is
// a conflict, never an overwrite); «Nueva nota», title, area and pin; delete and its exact
// «Deshacer»; the list and Hoy's read; authorization of every action; the export; and a failing
// action that never logs a note's text.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  createNote,
  deleteNote,
  pinNote,
  renameNote,
  restoreNote,
  saveDailyNote,
  saveNote,
  setNoteArea,
} from "@/modules/notes/actions";
import { getTodayNoteState } from "@/modules/notes/contracts";
import { NOTES_ERRORS } from "@/modules/notes/copy";
import { notes } from "@/modules/notes/db/schema";
import { dailyNoteLockKey, NOTES_ADVISORY_SPACE } from "@/modules/notes/lock-keys";
import { addDays } from "@/modules/notes/note-day";
import type { SaveResult } from "@/modules/notes/note-input";
import {
  getDailyNote,
  getDeletedNote,
  getPageNote,
  listNoteAreas,
  listNotes,
} from "@/modules/notes/queries";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
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

/** Lima's today for this run (the server refuses days that haven't come). */
const TODAY = ownerDateKey(new Date());
const YESTERDAY = addDays(TODAY, -1);

async function daily(day: string, body: string): Promise<SaveResult> {
  const result = await saveDailyNote({ day, body });
  if (!result.ok) throw new Error(`saveDailyNote failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function page(title = "Apuntes IAM", areaId: string | null = null): Promise<string> {
  const result = await createNote({ title, areaId });
  if (!result.ok) throw new Error(`createNote failed: ${JSON.stringify(result)}`);
  return result.data.id;
}

const rowOf = async (id: string) => (await testDb.select().from(notes).where(eq(notes.id, id)))[0];

async function areaIds(): Promise<string[]> {
  return (
    await testDb.select({ id: lifeAreas.id }).from(lifeAreas).orderBy(lifeAreas.sortOrder)
  ).map((area) => area.id);
}

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

describe("the table's own CHECKs", () => {
  test("a daily note and a knowledge note go in, with version 1 and an empty body", async () => {
    const [row] = await testDb
      .insert(notes)
      .values({ kind: "daily", day: "2026-11-01" })
      .returning();
    expect(row).toMatchObject({ body: "", version: 1, title: null, deletedAt: null });
    const [area] = await areaIds();
    const [pageRow] = await testDb
      .insert(notes)
      .values({ kind: "page", title: "Apuntes", areaId: area, pinnedAt: new Date() })
      .returning();
    expect(pageRow.areaId).toBe(area);
  });

  test.each([
    ["an unknown kind", { kind: "journal" }, "notes_kind_check"],
    ["a daily note without its day", { kind: "daily" }, "notes_day_check"],
    ["a page with a day", { kind: "page", title: "A", day: "2026-11-01" }, "notes_day_check"],
    ["a day before 2000", { kind: "daily", day: "1999-12-31" }, "notes_day_check"],
    ["a page without a title", { kind: "page" }, "notes_title_check"],
    [
      "a daily note with a title",
      { kind: "daily", day: "2026-11-01", title: "X" },
      "notes_title_check",
    ],
    ["an empty title", { kind: "page", title: "" }, "notes_title_check"],
    ["a title of 121 characters", { kind: "page", title: "x".repeat(121) }, "notes_title_check"],
    [
      "a body of 50 001 characters",
      { kind: "page", title: "A", body: "x".repeat(50_001) },
      "notes_body_check",
    ],
    [
      "a pin on a daily note",
      { kind: "daily", day: "2026-11-01", pinnedAt: new Date() },
      "notes_page_fields_check",
    ],
    ["version 0", { kind: "page", title: "A", version: 0 }, "notes_version_check"],
  ])("refuses %s", async (_, values, constraint) => {
    const result = await violation(() =>
      testDb.insert(notes).values(values as typeof notes.$inferInsert),
    );
    expect(result).toEqual({ code: "23514", constraint });
  });

  test("refuses an area on a daily note", async () => {
    const [area] = await areaIds();
    expect(
      await violation(() =>
        testDb.insert(notes).values({ kind: "daily", day: "2026-11-01", areaId: area }),
      ),
    ).toEqual({ code: "23514", constraint: "notes_page_fields_check" });
  });

  test("one live note per day; a deleted one doesn't block another (positive control)", async () => {
    await testDb.insert(notes).values({ kind: "daily", day: "2026-11-01", body: "a" });
    expect(
      await violation(() => testDb.insert(notes).values({ kind: "daily", day: "2026-11-01" })),
    ).toEqual({ code: "23505", constraint: "notes_daily_day_unique" });
    await testDb.update(notes).set({ deletedAt: new Date() });
    await testDb.insert(notes).values({ kind: "daily", day: "2026-11-01", body: "b" });
    // Two knowledge notes have no day at all.
    await testDb.insert(notes).values([
      { kind: "page", title: "A" },
      { kind: "page", title: "A" },
    ]);
  });

  test("Postgres refuses NUL in the body even past Zod (defense in depth)", async () => {
    const result = await violation(() =>
      testDb.insert(notes).values({ kind: "page", title: "A", body: "a\u0000b" }),
    );
    expect(result).not.toBeNull();
  });
});

describe("a day's first save", () => {
  test("creates the note with the normalized body; an empty body creates nothing", async () => {
    expect(await daily(TODAY, "   \n")).toEqual({ status: "empty" });
    expect(await testDb.select().from(notes)).toHaveLength(0);
    const saved = await daily(TODAY, "\nHoy fue un buen día  \r\n");
    expect(saved).toMatchObject({ status: "saved", body: "Hoy fue un buen día", version: 1 });
    expect(await getDailyNote(TODAY)).toMatchObject({ kind: "daily", day: TODAY, version: 1 });
  });

  test("a day that already has a note is a conflict with it, nothing written", async () => {
    const first = await daily(TODAY, "Primero");
    const second = await daily(TODAY, "Segundo");
    expect(second).toEqual({
      status: "conflict",
      current: { id: (first as { id: string }).id, body: "Primero", version: 1 },
    });
    expect(await testDb.select().from(notes)).toHaveLength(1);
  });

  test("two saves of the same day at once make one note; two days make two (positive control)", async () => {
    const same = await Promise.all([daily(TODAY, "Pestaña A"), daily(TODAY, "Pestaña B")]);
    expect(same.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
    expect(await testDb.select().from(notes)).toHaveLength(1);
    const two = await Promise.all([daily(YESTERDAY, "Ayer"), daily(addDays(TODAY, -2), "Antes")]);
    expect(two.map((result) => result.status)).toEqual(["saved", "saved"]);
    expect(await testDb.select().from(notes)).toHaveLength(3);
  });

  test("it waits for the day's lock (taken first)", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        NOTES_ADVISORY_SPACE,
        dailyNoteLockKey(TODAY),
      ]);
      let settled = false;
      const blocked = saveDailyNote({ day: TODAY, body: "Espera" }).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      // Positive control: another day doesn't wait.
      expect((await saveDailyNote({ day: YESTERDAY, body: "Ayer" })).ok).toBe(true);
      await holder.query("commit");
      expect((await blocked).ok).toBe(true);
    } finally {
      holder.release();
    }
  });

  test("a day that hasn't come yet is refused, and a malformed one too", async () => {
    const future = await saveDailyNote({ day: addDays(TODAY, 1), body: "Mañana" });
    expect(future).toMatchObject({ ok: false, fieldErrors: { day: [NOTES_ERRORS.day] } });
    expect((await saveDailyNote({ day: "2026-02-30", body: "x" })).ok).toBe(false);
    expect(await testDb.select().from(notes)).toHaveLength(0);
  });
});

describe("the autosave", () => {
  test("writes with the version it edited and bumps it; an old version is a conflict", async () => {
    const id = await page();
    const first = await saveNote({ id, body: "Uno", version: 1 });
    expect(first).toEqual({ ok: true, data: { status: "saved", id, body: "Uno", version: 2 } });
    // Another device still had version 1: nothing is overwritten.
    const stale = await saveNote({ id, body: "Otro", version: 1 });
    expect(stale).toEqual({
      ok: true,
      data: { status: "conflict", current: { id, body: "Uno", version: 2 } },
    });
    expect(await rowOf(id)).toMatchObject({ body: "Uno", version: 2 });
    // «Quedarme con la mía»: the same text with the version that is stored now.
    expect(await saveNote({ id, body: "Otro", version: 2 })).toMatchObject({
      ok: true,
      data: { status: "saved", version: 3 },
    });
  });

  test("two saves with the same version at once: one writes, the other is a conflict", async () => {
    const id = await page();
    const results = await Promise.all([
      saveNote({ id, body: "A", version: 1 }),
      saveNote({ id, body: "B", version: 1 }),
    ]);
    const statuses = results.map((result) => (result.ok ? result.data.status : "failed"));
    expect(statuses.sort()).toEqual(["conflict", "saved"]);
    expect((await rowOf(id)).version).toBe(2);
  });

  test("validates the body: 50 000 characters, control and bidi characters", async () => {
    const id = await page();
    expect((await saveNote({ id, body: "x".repeat(50_000), version: 1 })).ok).toBe(true);
    expect(await saveNote({ id, body: "x".repeat(50_001), version: 2 })).toMatchObject({
      ok: false,
      fieldErrors: { body: [NOTES_ERRORS.body.tooLong] },
    });
    expect(await saveNote({ id, body: "a\u0000b", version: 2 })).toMatchObject({
      fieldErrors: { body: [NOTES_ERRORS.body.control] },
    });
    expect(await saveNote({ id, body: "a\u202Eb", version: 2 })).toMatchObject({
      fieldErrors: { body: [NOTES_ERRORS.body.bidi] },
    });
    expect((await rowOf(id)).version).toBe(2);
  });

  test("a deleted note can't be saved", async () => {
    const id = await page();
    await deleteNote({ id });
    expect(await saveNote({ id, body: "x", version: 1 })).toEqual({
      ok: false,
      error: NOTES_ERRORS.notFound,
    });
  });

  test("a body save revalidates nothing (the open note isn't rendered again); a pin does", async () => {
    const id = await page();
    vi.mocked(revalidatePath).mockClear();
    await saveNote({ id, body: "x", version: 1 });
    await saveDailyNote({ day: TODAY, body: "Hoy" });
    await saveNote({ id, body: "y", version: 1 });
    expect(revalidatePath).not.toHaveBeenCalled();
    // Positive control: a change to the note itself revalidates every notes page and Hoy.
    await pinNote({ id, pinned: true });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/notes", "layout"], ["/"]]);
  });

  test("only the body and the title move «last edited»: pin, area, delete and restore don't", async () => {
    const [area] = await areaIds();
    const id = await page("Apuntes");
    const stamp = async () => (await rowOf(id)).updatedAt.getTime();
    const backdate = () =>
      testDb
        .update(notes)
        .set({ updatedAt: sql`now() - interval '1 day'` })
        .where(eq(notes.id, id));
    await backdate();
    const old = await stamp();
    await pinNote({ id, pinned: true });
    await setNoteArea({ id, areaId: area });
    await deleteNote({ id });
    await restoreNote({ id });
    expect(await stamp()).toBe(old);
    await saveNote({ id, body: "Texto", version: 1 });
    expect(await stamp()).toBeGreaterThan(old);
    await backdate();
    await renameNote({ id, title: "Apuntes AWS" });
    expect(await stamp()).toBeGreaterThan(old);
  });
});

describe("knowledge notes", () => {
  test("«Nueva nota» with an active area; an archived one is refused on its field", async () => {
    const [area, other] = await areaIds();
    const id = await page("  Apuntes   IAM ", area);
    expect(await getPageNote(id)).toMatchObject({
      title: "Apuntes IAM",
      body: "",
      version: 1,
      area: { id: area },
      pinned: false,
    });
    await testDb.update(lifeAreas).set({ archivedAt: new Date() }).where(eq(lifeAreas.id, other));
    expect(await createNote({ title: "B", areaId: other })).toMatchObject({
      ok: false,
      fieldErrors: { areaId: [NOTES_ERRORS.areaUnavailable] },
    });
    expect(await listNoteAreas()).not.toContainEqual(expect.objectContaining({ id: other }));
  });

  test("title, area and pin; the body's version doesn't move", async () => {
    const [area, second] = await areaIds();
    const id = await page("Apuntes", area);
    expect(await renameNote({ id, title: " Apuntes AWS " })).toMatchObject({
      ok: true,
      data: { title: "Apuntes AWS", version: 1 },
    });
    expect(await setNoteArea({ id, areaId: null })).toMatchObject({
      ok: true,
      data: { area: null },
    });
    expect(await setNoteArea({ id, areaId: second })).toMatchObject({
      ok: true,
      data: { area: { id: second } },
    });
    await pinNote({ id, pinned: true });
    const pinnedAt = (await rowOf(id)).pinnedAt;
    expect(pinnedAt).not.toBeNull();
    // Pinning again keeps the first pin time.
    await pinNote({ id, pinned: true });
    expect((await rowOf(id)).pinnedAt).toEqual(pinnedAt);
    expect(await pinNote({ id, pinned: false })).toMatchObject({
      ok: true,
      data: { pinned: false },
    });
    expect((await rowOf(id)).version).toBe(1);
  });

  test("keeping an area archived since is no change; moving to another archived one is refused", async () => {
    const [area, other] = await areaIds();
    const id = await page("Apuntes", area);
    await testDb.update(lifeAreas).set({ archivedAt: new Date() });
    expect((await setNoteArea({ id, areaId: area })).ok).toBe(true);
    expect(await setNoteArea({ id, areaId: other })).toMatchObject({
      fieldErrors: { areaId: [NOTES_ERRORS.areaUnavailable] },
    });
  });

  test("a daily note isn't renamed, pinned or put in an area", async () => {
    const saved = (await daily(TODAY, "Hoy")) as { id: string };
    const [area] = await areaIds();
    const notFound = { ok: false, error: NOTES_ERRORS.notFound };
    expect(await renameNote({ id: saved.id, title: "X" })).toEqual(notFound);
    expect(await pinNote({ id: saved.id, pinned: true })).toEqual(notFound);
    expect(await setNoteArea({ id: saved.id, areaId: area })).toEqual(notFound);
  });
});

describe("delete and «Deshacer»", () => {
  test("a deleted note leaves every view; «Deshacer» brings back exactly it", async () => {
    const id = await page();
    const other = await page("Otra");
    expect(await deleteNote({ id })).toEqual({
      ok: true,
      data: { id, kind: "page", day: null, title: "Apuntes IAM" },
    });
    expect(await getPageNote(id)).toBeNull();
    expect(
      (await listNotes({ kind: "all", areaId: null, shown: 30 })).items.map((n) => n.id),
    ).toEqual([other]);
    expect(await getDeletedNote(id)).toMatchObject({ id, title: "Apuntes IAM" });
    expect(await getDeletedNote(other)).toBeNull();
    // Deleting twice is refused.
    expect(await deleteNote({ id })).toEqual({ ok: false, error: NOTES_ERRORS.notFound });
    expect((await restoreNote({ id })).ok).toBe(true);
    expect(await getPageNote(id)).toMatchObject({ id });
    expect((await rowOf(other)).deletedAt).toBeNull();
  });

  test("a daily note comes back only if its day has no other note meanwhile", async () => {
    const first = (await daily(TODAY, "Primera")) as { id: string };
    await deleteNote({ id: first.id });
    // The day is free again: writing creates another note.
    const second = (await daily(TODAY, "Segunda")) as { id: string };
    expect(second.id).not.toBe(first.id);
    expect(await restoreNote({ id: first.id })).toEqual({
      ok: false,
      error: NOTES_ERRORS.dayTaken,
    });
    expect((await rowOf(first.id)).deletedAt).not.toBeNull();
    // Positive control: with the other one deleted, it comes back.
    await deleteNote({ id: second.id });
    expect((await restoreNote({ id: first.id })).ok).toBe(true);
    expect(await getDailyNote(TODAY)).toMatchObject({ id: first.id, body: "Primera" });
  });
});

describe("the list and Hoy", () => {
  test("pinned first, then by last edit; filters by kind and area; «more» past the limit", async () => {
    const [area] = await areaIds();
    const old = await page("Vieja");
    const pinned = await page("Fijada", area);
    const recent = await page("Reciente", area);
    await daily(YESTERDAY, "# Ayer\n\n- [ ] Llamar al banco");
    await testDb
      .update(notes)
      .set({ updatedAt: sql`now() - interval '2 days'` })
      .where(eq(notes.id, old));
    await pinNote({ id: pinned, pinned: true });
    await testDb
      .update(notes)
      .set({ updatedAt: sql`now() - interval '3 days'` })
      .where(eq(notes.id, pinned));
    await saveNote({ id: recent, body: "Lo **último**", version: 1 });

    const all = await listNotes({ kind: "all", areaId: null, shown: 30 });
    expect(all.items.map((item) => item.title ?? item.day)).toEqual([
      "Fijada",
      "Reciente",
      YESTERDAY,
      "Vieja",
    ]);
    expect(all.items[1]).toMatchObject({ excerpt: "Lo último", editedOn: TODAY });
    expect(all.items[2]).toMatchObject({ kind: "daily", excerpt: "Ayer" });
    expect(all.more).toBe(false);
    expect(
      (await listNotes({ kind: "daily", areaId: null, shown: 30 })).items.map((i) => i.day),
    ).toEqual([YESTERDAY]);
    expect(
      (await listNotes({ kind: "all", areaId: area, shown: 30 })).items.map((i) => i.title),
    ).toEqual(["Fijada", "Reciente"]);
    const firstTwo = await listNotes({ kind: "all", areaId: null, shown: 2 });
    expect(firstTwo).toMatchObject({ more: true });
    expect(firstTwo.items).toHaveLength(2);
    // A malformed area id filters nothing (no query with it).
    expect((await listNotes({ kind: "all", areaId: "x", shown: 30 })).items).toHaveLength(4);
  });

  test("Hoy's key: today's note with text, or not", async () => {
    const now = new Date();
    expect(await getTodayNoteState(now)).toEqual({ day: TODAY, hasText: false });
    await daily(YESTERDAY, "Ayer");
    expect(await getTodayNoteState(now)).toEqual({ day: TODAY, hasText: false });
    const saved = (await daily(TODAY, "Hoy")) as { id: string };
    expect(await getTodayNoteState(now)).toEqual({ day: TODAY, hasText: true });
    await saveNote({ id: saved.id, body: "", version: 1 });
    expect(await getTodayNoteState(now)).toEqual({ day: TODAY, hasText: false });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and every write is refused", async (_, headers) => {
    const id = await page("Del owner");
    const saved = (await daily(YESTERDAY, "Del owner")) as { id: string };
    // Positive control: the owner reads.
    expect((await listNotes({ kind: "all", areaId: null, shown: 30 })).items).toHaveLength(2);

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listNotes({ kind: "all", areaId: null, shown: 30 })).rejects.toMatchObject(
      redirect,
    );
    await expect(getDailyNote(YESTERDAY)).rejects.toMatchObject(redirect);
    await expect(getPageNote(id)).rejects.toMatchObject(redirect);
    await expect(getDeletedNote(id)).rejects.toMatchObject(redirect);
    await expect(getTodayNoteState(new Date())).rejects.toMatchObject(redirect);
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await saveDailyNote({ day: TODAY, body: "Intruso" })).toEqual(refused);
    expect(await saveNote({ id, body: "Intruso", version: 1 })).toEqual(refused);
    expect(await createNote({ title: "Intruso", areaId: null })).toEqual(refused);
    expect(await renameNote({ id, title: "Intruso" })).toEqual(refused);
    expect(await setNoteArea({ id, areaId: null })).toEqual(refused);
    expect(await pinNote({ id, pinned: true })).toEqual(refused);
    expect(await deleteNote({ id: saved.id })).toEqual(refused);
    expect(await restoreNote({ id })).toEqual(refused);
    expect(await rowOf(id)).toMatchObject({ title: "Del owner", body: "", pinnedAt: null });
    expect(await rowOf(saved.id)).toMatchObject({ body: "Del owner", deletedAt: null });
    expect(await testDb.select().from(notes)).toHaveLength(2);
  });
});

describe("export and logs", () => {
  test("every note is exported, deleted ones included", async () => {
    const id = await page();
    await daily(TODAY, "Hoy");
    await deleteNote({ id });
    const data = await buildExport(testDb, new Date());
    const table = data.tables.notes;
    expect(table.rowCount).toBe(2);
    expect(table.rows.map((row) => (row as { kind: string }).kind).sort()).toEqual([
      "daily",
      "page",
    ]);
    const deleted = table.rows.find((row) => (row as { id: string }).id === id) as {
      title: string;
      deleted_at: unknown;
    };
    expect(deleted.title).toBe("Apuntes IAM");
    expect(deleted.deleted_at).not.toBeNull();
  });

  test("a failing action logs the error's name and code, never the note's title or body", async () => {
    const id = await page("Título secreto");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const update = vi.spyOn(testDb, "update").mockImplementation(() => {
      throw Object.assign(new Error("Failed query: update notes ... params: Cuerpo secreto"), {
        cause: { code: "08006" },
      });
    });
    try {
      const result = await saveNote({ id, body: "Cuerpo secreto", version: 1 });
      expect(result.ok).toBe(false);
      const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("saveNote");
      expect(logged).toContain("08006");
      expect(logged).not.toContain("secreto");
    } finally {
      update.mockRestore();
      spy.mockRestore();
    }
  });
});
