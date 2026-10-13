// W1 of `weekly-review`: the CHECKs and the primary key of `weekly_reviews` with raw inserts
// (defense in depth behind Zod: scripts, raw SQL or a bug can't store a week that is not a Monday
// or a note that is empty or too long), concurrent inserts of one week ending with one row (with
// a positive control), the internal reads (`selectReviewRow`, `selectClosedWeeks`, the
// authorization of `getReviewRow` and `listClosedWeeks`) and the export.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { buildExport, EXPORTABLE_TABLES } from "@/lib/data-export";
import { seed } from "@/modules/core/seed";
import { weeklyReviews } from "@/modules/weekly-review/db/schema";
import {
  getReviewRow,
  hasReview,
  listClosedWeeks,
  PREVIOUS_WEEKS_LIMIT,
  selectClosedWeeks,
  selectReviewRow,
} from "@/modules/weekly-review/queries";
import { WEEKLY_REVIEW_ADVISORY_SPACE } from "@/modules/weekly-review/lock-keys";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

const AT = new Date("2026-10-18T23:30:00Z");

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

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

const review =
  (values: Partial<typeof weeklyReviews.$inferInsert> = {}) =>
  () =>
    testDb.insert(weeklyReviews).values({ weekStart: "2026-10-12", completedAt: AT, ...values });

const check = (constraint: string) => ({ code: "23514", constraint });

describe("weekly_reviews CHECKs", () => {
  test("a Monday with or without a note passes (positive controls)", async () => {
    expect(await violation(review())).toBeNull();
    expect(
      await violation(review({ weekStart: "2026-10-19", note: "Aprendí a cerrar" })),
    ).toBeNull();
    expect(await violation(review({ weekStart: "2026-10-26", note: "a" }))).toBeNull();
    expect(await violation(review({ weekStart: "2026-11-02", note: "x".repeat(280) }))).toBeNull();
    expect(await testDb.select().from(weeklyReviews)).toHaveLength(4);
  });

  test.each(["2026-10-13", "2026-10-14", "2026-10-17", "2026-10-18", "2026-02-28", "2028-02-29"])(
    "%s is not a Monday",
    async (weekStart) => {
      expect(await violation(review({ weekStart }))).toEqual(check("weekly_reviews_monday_check"));
    },
  );

  test("a note of 0 or 281 characters is refused; NULL is fine", async () => {
    expect(await violation(review({ note: "" }))).toEqual(
      check("weekly_reviews_note_length_check"),
    );
    expect(await violation(review({ note: "x".repeat(281) }))).toEqual(
      check("weekly_reviews_note_length_check"),
    );
    expect(await violation(review({ note: null }))).toBeNull();
  });

  test("a week is one row: the key is the Monday (23505), and completed_at is required", async () => {
    await review()();
    expect(await violation(review({ note: "otra" }))).toEqual({
      code: "23505",
      constraint: "weekly_reviews_pkey",
    });
    expect(
      await violation(() =>
        testDb.execute(sql`insert into weekly_reviews (week_start) values ('2026-10-19')`),
      ),
    ).toMatchObject({ code: "23502" });
  });

  test("updated_at is stamped by the database on a Drizzle update", async () => {
    await review()();
    const [before] = await testDb.select().from(weeklyReviews);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await testDb.update(weeklyReviews).set({ note: "Nueva" });
    const [after] = await testDb.select().from(weeklyReviews);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});

describe("concurrent closes of one week", () => {
  const upsert = (weekStart: string, note: string) =>
    testDb
      .insert(weeklyReviews)
      .values({ weekStart, completedAt: AT, note })
      .onConflictDoUpdate({ target: weeklyReviews.weekStart, set: { note } });

  test("two at once leave one row; different weeks leave two (positive control)", async () => {
    await Promise.all([upsert("2026-10-12", "uno"), upsert("2026-10-12", "dos")]);
    expect(await testDb.select().from(weeklyReviews)).toHaveLength(1);
    await Promise.all([upsert("2026-10-19", "uno"), upsert("2026-10-26", "dos")]);
    expect(await testDb.select().from(weeklyReviews)).toHaveLength(3);
  });

  test("the lock space is 6000, free of the other modules' (the key is the week's Monday)", async () => {
    expect(WEEKLY_REVIEW_ADVISORY_SPACE).toBe(6_000);
    // Two transactions taking (6000, hashtext(week)): the second waits for the first.
    const first = await testDb.$client.connect();
    try {
      await first.query("begin");
      await first.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        WEEKLY_REVIEW_ADVISORY_SPACE,
        "2026-10-12",
      ]);
      const other = await testDb.$client.connect();
      try {
        const same = await other.query(
          "select pg_try_advisory_xact_lock($1, hashtext($2)) as got",
          [WEEKLY_REVIEW_ADVISORY_SPACE, "2026-10-12"],
        );
        expect(same.rows[0].got).toBe(false);
        const differentWeek = await other.query(
          "select pg_try_advisory_xact_lock($1, hashtext($2)) as got",
          [WEEKLY_REVIEW_ADVISORY_SPACE, "2026-10-19"],
        );
        expect(differentWeek.rows[0].got).toBe(true);
      } finally {
        other.release();
      }
      await first.query("rollback");
    } finally {
      first.release();
    }
  });
});

describe("reads", () => {
  test("a closed week reads back; an open or malformed one is null", async () => {
    await review({ note: "Aprendí" })();
    expect(await selectReviewRow(testDb, "2026-10-12")).toEqual({
      weekStart: "2026-10-12",
      completedAt: AT.toISOString(),
      note: "Aprendí",
    });
    expect(await selectReviewRow(testDb, "2026-10-19")).toBeNull();
    expect(await getReviewRow("2026-10-12")).toMatchObject({ note: "Aprendí" });
    expect(await getReviewRow("2026-10-19")).toBeNull();
    // Not a Monday: no query (and no database error).
    expect(await getReviewRow("2026-10-13")).toBeNull();
    expect(await getReviewRow("no")).toBeNull();
    expect(await hasReview("2026-10-12")).toBe(true);
    expect(await hasReview("2026-10-19")).toBe(false);
  });

  test("the closed weeks, the most recent first, at most 12 by default", async () => {
    const mondays: string[] = [];
    for (let index = 0; index < 15; index += 1) {
      const day = new Date(Date.UTC(2026, 6, 6 + 7 * index)).toISOString().slice(0, 10);
      mondays.push(day);
      await review({ weekStart: day, note: index % 2 === 0 ? `Nota ${index}` : null })();
    }
    const last = await listClosedWeeks();
    expect(last).toHaveLength(PREVIOUS_WEEKS_LIMIT);
    expect(last.map((row) => row.weekStart)).toEqual([...mondays].reverse().slice(0, 12));
    expect(last[0]).toMatchObject({ weekStart: mondays[14], note: "Nota 14" });
    expect(last[1].note).toBeNull();
    expect(await listClosedWeeks(3)).toHaveLength(3);
    expect(await selectClosedWeeks(testDb, 100)).toHaveLength(15);
    // A silly limit is clamped, never an error.
    expect(await listClosedWeeks(0)).toHaveLength(1);
    expect(await listClosedWeeks(10_000)).toHaveLength(15);
  });

  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login", async (_, headers) => {
    await review()();
    // Positive control: the owner reads it.
    expect(await getReviewRow("2026-10-12")).not.toBeNull();
    expect(await listClosedWeeks()).toHaveLength(1);
    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getReviewRow("2026-10-12")).rejects.toMatchObject(toLogin);
    await expect(hasReview("2026-10-12")).rejects.toMatchObject(toLogin);
    await expect(listClosedWeeks()).rejects.toMatchObject(toLogin);
  });
});

describe("export", () => {
  test("the table is exportable and its rows (with and without a note) are in the export", async () => {
    expect(EXPORTABLE_TABLES.some(({ table }) => table === weeklyReviews)).toBe(true);
    await review({ weekStart: "2026-10-19", note: "Segunda" })();
    await review({ weekStart: "2026-10-12", note: null })();
    const data = await buildExport(testDb, new Date("2026-10-20T15:00:00Z"));
    expect(data.tables.weekly_reviews.rowCount).toBe(2);
    expect(data.tables.weekly_reviews.rows.map((row) => [row.week_start, row.note])).toEqual([
      ["2026-10-12", null],
      ["2026-10-19", "Segunda"],
    ]);
    expect(data.excludedTables).not.toContain("weekly_reviews");
  });
});
