// H1 of `household` against the throwaway database: the cleaning is a task tagged `limpieza` plus
// a zone. The risk this file closes first: completing a recurring task creates the NEXT occurrence
// as another row, so the series only survives if that row copies the tags. Also: the five
// frequencies, the exact «Deshacer» of «Hecho» and «Quitar», idempotent completion, what the
// contract lists and authorization.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import {
  addCleaning,
  completeCleaning,
  removeCleaning,
  reopenCleaning,
  restoreCleaning,
} from "@/modules/household/actions";
import { CLEANING_TAG } from "@/modules/household/cleaning";
import { createTaskWithTags, getTasksByTag } from "@/modules/tasks/contracts";
import { tasks } from "@/modules/tasks/db/schema";
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

const today = () => ownerDateKey(new Date());
const addDays = (key: string, days: number) =>
  new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const isoWeekday = (key: string) => {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

type Add = Parameters<typeof addCleaning>[0];

async function add(input: Record<string, unknown>) {
  const result = await addCleaning({ zone: "Baño", ...input } as Add);
  if (!result.ok) throw new Error(`addCleaning failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function done(id: string) {
  const result = await completeCleaning({ id });
  if (!result.ok) throw new Error(`completeCleaning failed: ${JSON.stringify(result)}`);
  return result.data;
}

const listed = () => getTasksByTag(CLEANING_TAG);

describe("adding a cleaning", () => {
  test("creates a pending task with the cleaning tag, its zone, its first day and its rule", async () => {
    const item = await add({
      title: "  Limpiar   inodoro ",
      frequency: "weekly",
      weekdays: [1, 4],
    });
    const [task] = await listed();
    expect(task).toMatchObject({
      id: item.id,
      title: "Limpiar inodoro",
      recurrence: { kind: "weekdays", interval: null, weekdays: [1, 4], monthDay: null },
    });
    expect(task.tags.toSorted()).toEqual(["limpieza", "zona: baño"]);
    // The first day is the first of the chosen weekdays from today (a Monday or a Thursday).
    expect([1, 4]).toContain(isoWeekday(task.dueDate!));
    expect(task.dueDate! >= today() && task.dueDate! < addDays(today(), 7)).toBe(true);
    expect(item).toMatchObject({ title: "Limpiar inodoro", zone: "baño" });
  });

  test("a non-weekly frequency without a date starts today, and a given date is kept", async () => {
    await add({ title: "Barrer", frequency: "daily" });
    const future = addDays(today(), 10);
    await add({ title: "Trapear", frequency: "monthly", firstDate: future });
    const byTitle = Object.fromEntries((await listed()).map((task) => [task.title, task]));
    expect(byTitle["Barrer"].dueDate).toBe(today());
    expect(byTitle["Trapear"].dueDate).toBe(future);
  });

  test("a first day in the past is refused on its field and nothing is written", async () => {
    const result = await addCleaning({
      title: "Barrer",
      zone: "Baño",
      frequency: "daily",
      firstDate: addDays(today(), -1),
    });
    expect(result).toMatchObject({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { firstDate: [expect.stringContaining("pasado")] },
    });
    expect(await testDb.select().from(tasks)).toHaveLength(0);
  });

  test("invalid input is refused before touching the database", async () => {
    for (const bad of [
      { title: "", frequency: "daily" },
      { title: "Barrer", frequency: "weekly", weekdays: [] },
      { title: "Barrer", frequency: "daily", zone: "a, b" },
      { title: "Barrer", frequency: "daily", zone: "x".repeat(25) },
    ]) {
      const result = await addCleaning({ zone: "Baño", ...bad });
      expect(result.ok).toBe(false);
    }
    expect(await testDb.select().from(tasks)).toHaveLength(0);
  });

  test("it revalidates the household and the screens that list tasks (Hoy among them)", async () => {
    await add({ title: "Barrer", frequency: "daily" });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
    expect(paths).toContain("/household");
    expect(paths).toContain("/tasks");
    expect(paths).toContain("/");
  });
});

describe("«Hecho» keeps the series", () => {
  test.each([
    ["daily", {}, (from: string) => addDays(from, 1)],
    ["biweekly", {}, (from: string) => addDays(from, 14)],
  ] as const)(
    "%s: the next occurrence copies the tags and counts from today",
    async (frequency, extra, expected) => {
      const first = await add({ title: "Limpiar", frequency, ...extra });
      const result = await done(first.id);
      expect(result.nextDueDate).toBe(expected(today()));
      // The task that was done left the view; the next one is listed with the same tags.
      const after = await listed();
      expect(after).toHaveLength(1);
      expect(after[0].id).not.toBe(first.id);
      expect(after[0].tags.toSorted()).toEqual(["limpieza", "zona: baño"]);
      expect(after[0]).toMatchObject({ title: "Limpiar", dueDate: result.nextDueDate });
      expect(after[0].recurrence).not.toBeNull();
    },
  );

  test("weekly: the next one is the first chosen weekday from tomorrow", async () => {
    const first = await add({ title: "Limpiar", frequency: "weekly", weekdays: [2, 5] });
    const result = await done(first.id);
    const next = result.nextDueDate!;
    expect([2, 5]).toContain(isoWeekday(next));
    expect(next >= addDays(today(), 1) && next <= addDays(today(), 7)).toBe(true);
    expect((await listed())[0].tags.toSorted()).toEqual(["limpieza", "zona: baño"]);
  });

  test("monthly and quarterly count months from today", async () => {
    const monthly = await add({ title: "Mensual", frequency: "monthly" });
    const quarterly = await add({ title: "Trimestral", frequency: "quarterly" });
    const months = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
    const a = await done(monthly.id);
    const b = await done(quarterly.id);
    expect(months(a.nextDueDate!) - months(today())).toBe(1);
    expect(months(b.nextDueDate!) - months(today())).toBe(3);
    expect(await listed()).toHaveLength(2);
  });

  test("a double tap completes once and creates a single next occurrence", async () => {
    const first = await add({ title: "Limpiar", frequency: "daily" });
    await Promise.all([done(first.id), done(first.id)]);
    expect(await listed()).toHaveLength(1);
    // The done one and its single spawn: two rows, one pending.
    const rows = await testDb.select().from(tasks);
    expect(rows).toHaveLength(2);
  });

  test("«Deshacer» reopens that task and removes the next one if nobody touched it", async () => {
    const first = await add({ title: "Limpiar", frequency: "daily" });
    await done(first.id);
    expect((await listed())[0].id).not.toBe(first.id);
    const result = await reopenCleaning({ id: first.id });
    expect(result).toEqual({ ok: true, data: { id: first.id } });
    const after = await listed();
    expect(after.map((task) => task.id)).toEqual([first.id]);
    expect(await testDb.select().from(tasks)).toHaveLength(2); // the spawn is soft-deleted, not listed
  });

  test("an unknown task is «ya no está», for every action", async () => {
    const id = "00000000-0000-4000-8000-0000000000ff";
    for (const action of [completeCleaning, reopenCleaning, removeCleaning, restoreCleaning]) {
      const result = await action({ id });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("ya no está") });
    }
  });
});

describe("«Quitar»", () => {
  test("deletes the task (it leaves the view, stays in the table) and «Deshacer» brings it back", async () => {
    const item = await add({ title: "Limpiar", frequency: "daily" });
    const removed = await removeCleaning({ id: item.id });
    expect(removed).toEqual({ ok: true, data: { id: item.id, title: "Limpiar" } });
    expect(await listed()).toEqual([]);
    const [row] = await testDb.select().from(tasks).where(eq(tasks.id, item.id));
    expect(row.deletedAt).not.toBeNull();
    // A second «Quitar» finds nothing to remove.
    expect((await removeCleaning({ id: item.id })).ok).toBe(false);

    expect(await restoreCleaning({ id: item.id })).toEqual({ ok: true, data: { id: item.id } });
    expect((await listed()).map((task) => task.id)).toEqual([item.id]);
    // Restoring twice changes nothing.
    expect((await restoreCleaning({ id: item.id })).ok).toBe(true);
    expect(await listed()).toHaveLength(1);
  });
});

describe("what the contract lists", () => {
  test("only pending, visible tasks that carry the tag, the soonest first and the dateless last", async () => {
    const soon = await add({ title: "B pronto", frequency: "daily" });
    const later = await add({
      title: "A luego",
      frequency: "monthly",
      firstDate: addDays(today(), 5),
    });
    const finished = await add({ title: "Hecha", frequency: "daily" });
    const gone = await add({ title: "Quitada", frequency: "daily" });
    // A task with another tag, and one with the tag but no date and no recurrence.
    await createTaskWithTags({ title: "De compras", tags: ["compras"] });
    await createTaskWithTags({ title: "Sin fecha", tags: [CLEANING_TAG] });
    await testDb.update(tasks).set({ doneAt: new Date() }).where(eq(tasks.id, finished.id));
    await removeCleaning({ id: gone.id });

    const titles = (await listed()).map((task) => task.title);
    expect(titles).toEqual(["B pronto", "A luego", "Sin fecha"]);
    expect((await listed())[0].id).toBe(soon.id);
    expect((await listed())[1].id).toBe(later.id);
  });

  test("creating a task with tags through the contract rejects what the quick capture rejects", async () => {
    await expect(createTaskWithTags({ title: "   " })).rejects.toThrow(RangeError);
    await expect(createTaskWithTags({ title: "Algo", tags: ["con,coma"] })).rejects.toThrow(
      RangeError,
    );
    expect(await testDb.select().from(tasks)).toHaveLength(0);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the read redirects to /login and every write is refused", async (_, headers) => {
    const item = await add({ title: "Del owner", frequency: "daily" });
    // Positive control: the owner reads.
    expect(await listed()).toHaveLength(1);

    request.headers = await headers();
    await expect(listed()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await addCleaning({ title: "Intruso", zone: "Baño", frequency: "daily" })).toEqual(
      refused,
    );
    for (const action of [completeCleaning, reopenCleaning, removeCleaning, restoreCleaning]) {
      expect(await action({ id: item.id })).toEqual(refused);
    }
    expect((await testDb.select().from(tasks)).map((row) => row.title)).toEqual(["Del owner"]);
  });
});
