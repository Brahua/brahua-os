// W3 of `weekly-review`: «Cerrar la semana» against the throwaway database. The action sets the
// next week's objective through `goals` (its own transaction and lock), then records the week
// under its own lock: idempotent, the note updated, completed_at set once, two closes at once one
// row, an empty objective never clears an existing one, invalid and future weeks refused.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { seed } from "@/modules/core/seed";
import { weeklyObjectives } from "@/modules/goals/db/schema";
import { closeWeek } from "@/modules/weekly-review/actions";
import { weeklyReviews } from "@/modules/weekly-review/db/schema";
import { closeWeekRow } from "@/modules/weekly-review/review";
import { REVIEW_ERRORS } from "@/modules/weekly-review/review-copy";
import { getReviewRow } from "@/modules/weekly-review/queries";
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

/** Monday 2026-10-19, 10:00 in Lima: closing the week 12–18 that just ended. */
const NOW = new Date("2026-10-19T15:00:00Z");
const WEEK = "2026-10-12";
const NEXT = "2026-10-19";

const reviews = () => testDb.select().from(weeklyReviews);
const objectiveOf = async (week: string) =>
  (await testDb.select().from(weeklyObjectives).where(eq(weeklyObjectives.weekStart, week)))[0]
    ?.text ?? null;

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("closeWeek", () => {
  test("closes the week with its note, writes the next week's objective and revalidates", async () => {
    const result = await closeWeek({
      weekStart: WEEK,
      note: "  Aprendí   a descansar ",
      objective: "Terminar la spec",
    });
    expect(result).toEqual({ ok: true, data: { weekStart: WEEK } });
    const [row] = await reviews();
    expect(row).toMatchObject({ weekStart: WEEK, note: "Aprendí a descansar" });
    expect(row.completedAt.getTime()).toBe(NOW.getTime());
    // The NEXT week, the same store /goals reads.
    expect(await objectiveOf(NEXT)).toBe("Terminar la spec");
    expect(await objectiveOf(WEEK)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/review");
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
    // The invitation card is gone from Hoy and Metas on the next visit (W4).
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/goals");
  });

  test("with no note and no objective it still closes (a blank note is no note)", async () => {
    expect(await closeWeek({ weekStart: WEEK, note: "   ", objective: "" })).toMatchObject({
      ok: true,
    });
    expect(await closeWeek({ weekStart: "2026-10-05" })).toMatchObject({ ok: true });
    expect((await reviews()).map((row) => [row.weekStart, row.note]).sort()).toEqual([
      ["2026-10-05", null],
      [WEEK, null],
    ]);
    expect(await objectiveOf(NEXT)).toBeNull();
  });

  test("an empty objective leaves the one already set (never cleared by accident)", async () => {
    await testDb.insert(weeklyObjectives).values({ weekStart: NEXT, text: "El de /goals" });
    await closeWeek({ weekStart: WEEK, note: "Nota", objective: "" });
    expect(await objectiveOf(NEXT)).toBe("El de /goals");
    await closeWeek({ weekStart: WEEK, note: "Nota", objective: "   " });
    expect(await objectiveOf(NEXT)).toBe("El de /goals");
    // A typed one replaces it.
    await closeWeek({ weekStart: WEEK, note: "Nota", objective: "Uno nuevo" });
    expect(await objectiveOf(NEXT)).toBe("Uno nuevo");
  });

  test("closing again is idempotent: one row, completed_at stays, the note is updated or cleared", async () => {
    await closeWeek({ weekStart: WEEK, note: "Primera", objective: "Mi objetivo" });
    const [first] = await reviews();
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    revalidatePathReset();
    await closeWeek({ weekStart: WEEK, note: "Segunda", objective: "Mi objetivo" });
    const [second] = await reviews();
    expect(await reviews()).toHaveLength(1);
    expect(second.note).toBe("Segunda");
    expect(second.completedAt.getTime()).toBe(first.completedAt.getTime());
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    // The same objective again writes nothing in /goals (it was not touched).
    expect(revalidatePath).not.toHaveBeenCalledWith("/goals", "layout");
    expect(await objectiveOf(NEXT)).toBe("Mi objetivo");
    await closeWeek({ weekStart: WEEK, note: "", objective: "" });
    expect((await getReviewRow(WEEK))?.note).toBeNull();
    expect(await reviews()).toHaveLength(1);
  });

  test("two closes at once leave one row (positive control: two different weeks leave two)", async () => {
    await Promise.all([
      closeWeek({ weekStart: WEEK, note: "uno", objective: "A" }),
      closeWeek({ weekStart: WEEK, note: "dos", objective: "A" }),
      closeWeek({ weekStart: WEEK, note: "tres", objective: "" }),
    ]);
    expect(await reviews()).toHaveLength(1);
    expect(["uno", "dos", "tres"]).toContain((await reviews())[0].note);
    await Promise.all([
      closeWeek({ weekStart: "2026-10-05", note: "a" }),
      closeWeek({ weekStart: "2026-09-28", note: "b" }),
    ]);
    expect(await reviews()).toHaveLength(3);
  });

  test("the domain function is the same upsert (called straight, with the clock it is given)", async () => {
    const later = new Date("2026-10-20T10:00:00Z");
    const row = await closeWeekRow(testDb, { weekStart: WEEK, note: "x" }, NOW);
    const again = await closeWeekRow(testDb, { weekStart: WEEK, note: "y" }, later);
    expect(again.completedAt).toBe(row.completedAt);
    expect(again.note).toBe("y");
  });

  test.each([
    ["not a Monday", "2026-10-13"],
    ["not a day", "2026-02-30"],
    ["garbage", "ayer"],
  ])(
    "an invalid week (%s) is refused with its field error and writes nothing",
    async (_n, week) => {
      const result = await closeWeek({ weekStart: week, note: "n", objective: "Algo" });
      expect(result).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { weekStart: [REVIEW_ERRORS.weekInvalid] },
      });
      expect(await reviews()).toHaveLength(0);
      expect(await testDb.select().from(weeklyObjectives)).toHaveLength(0);
    },
  );

  test("a future week is refused and nothing is written", async () => {
    // The week after the current one (the current one, 19–25, is a Monday that is reviewable).
    const result = await closeWeek({ weekStart: "2026-10-26", note: "n", objective: "Algo" });
    expect(result).toEqual({ ok: false, error: REVIEW_ERRORS.weekFuture });
    expect(await reviews()).toHaveLength(0);
    expect(await testDb.select().from(weeklyObjectives)).toHaveLength(0);
    // Positive control: the week in progress can be closed.
    expect(await closeWeek({ weekStart: NEXT, note: "n" })).toMatchObject({ ok: true });
  });

  test("a note over 280 or an objective over 140 is refused whole: nothing is written, not even the other", async () => {
    const longNote = await closeWeek({ weekStart: WEEK, note: "x".repeat(281), objective: "Bien" });
    expect(longNote).toMatchObject({
      ok: false,
      fieldErrors: { note: [REVIEW_ERRORS.noteTooLong] },
    });
    const longObjective = await closeWeek({
      weekStart: WEEK,
      note: "Bien",
      objective: "y".repeat(141),
    });
    expect(longObjective).toMatchObject({
      ok: false,
      fieldErrors: { objective: [REVIEW_ERRORS.objectiveTooLong] },
    });
    expect(await reviews()).toHaveLength(0);
    expect(await testDb.select().from(weeklyObjectives)).toHaveLength(0);
  });

  test("a repeat after a half close finishes the job (the objective was written, the row was not)", async () => {
    await testDb.insert(weeklyObjectives).values({ weekStart: NEXT, text: "Ya estaba" });
    expect(await reviews()).toHaveLength(0);
    expect(await closeWeek({ weekStart: WEEK, note: "n", objective: "Ya estaba" })).toMatchObject({
      ok: true,
    });
    expect(await reviews()).toHaveLength(1);
  });
});

function revalidatePathReset() {
  vi.mocked(revalidatePath).mockClear();
}

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("%s: the action refuses before touching anything", async (_name, headers) => {
    // Positive control: the owner closes.
    expect(await closeWeek({ weekStart: "2026-10-05", note: "n" })).toMatchObject({ ok: true });
    request.headers = await headers();
    vi.mocked(revalidatePath).mockClear();
    const result = await closeWeek({ weekStart: WEEK, note: "x", objective: "Intocable" });
    expect(result).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect((await reviews()).map((row) => row.weekStart)).toEqual(["2026-10-05"]);
    expect(await objectiveOf(NEXT)).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
