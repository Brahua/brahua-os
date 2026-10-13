// W4 of `weekly-review`, the invitation against the throwaway database: `selectReviewInvite` /
// `getReviewInvite` give the week to close from Sunday 18:00 to Monday 23:59 (Lima) and nothing
// when that week has a closed row; the Lima midnight (05:00Z) moves the window by the Lima clock,
// not UTC's; the owner is checked first.
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { seed } from "@/modules/core/seed";
import { getReviewInvite, selectReviewInvite } from "@/modules/weekly-review/contracts";
import { weeklyReviews } from "@/modules/weekly-review/db/schema";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

// Lima is UTC-5: 2026-10-11 is a Sunday, the week of Monday 2026-10-05 ends that day.
const SUNDAY_1759 = new Date("2026-10-11T22:59:00Z");
const SUNDAY_1800 = new Date("2026-10-11T23:00:00Z");
const MONDAY_2359 = new Date("2026-10-13T04:59:00Z");
const TUESDAY_0000 = new Date("2026-10-13T05:00:00Z");
const WEEK = "2026-10-05";

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  await testDb.delete(weeklyReviews);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const close = (week: string) =>
  testDb.insert(weeklyReviews).values({ weekStart: week, completedAt: SUNDAY_1800 });

describe("selectReviewInvite", () => {
  test("the window: Sunday 17:59 no, 18:00 yes, Monday 23:59 yes, Tuesday 00:00 no", async () => {
    expect(await selectReviewInvite(testDb, SUNDAY_1759)).toBeNull();
    expect(await selectReviewInvite(testDb, SUNDAY_1800)).toEqual({
      weekStart: WEEK,
      href: `/review?semana=${WEEK}`,
    });
    // Monday: still the week that ended yesterday, not the one that started today.
    expect(await selectReviewInvite(testDb, MONDAY_2359)).toEqual({
      weekStart: WEEK,
      href: `/review?semana=${WEEK}`,
    });
    expect(await selectReviewInvite(testDb, TUESDAY_0000)).toBeNull();
  });

  test("Monday 00:00 Lima (05:00Z) is the Monday window, Sunday 23:59 Lima (04:59Z) the Sunday one", async () => {
    expect((await selectReviewInvite(testDb, new Date("2026-10-12T04:59:00Z")))?.weekStart).toBe(
      WEEK,
    );
    expect((await selectReviewInvite(testDb, new Date("2026-10-12T05:00:00Z")))?.weekStart).toBe(
      WEEK,
    );
  });

  test("a closed week hides the card, on Sunday and on Monday; another week's row does not", async () => {
    await close("2026-09-28");
    expect(await selectReviewInvite(testDb, SUNDAY_1800)).not.toBeNull();
    await close(WEEK);
    expect(await selectReviewInvite(testDb, SUNDAY_1800)).toBeNull();
    expect(await selectReviewInvite(testDb, MONDAY_2359)).toBeNull();
  });

  test("on Monday it offers the previous week even when this week has a row", async () => {
    // This week's row (a week closed ahead of time) says nothing about the week that ended.
    await close("2026-10-12");
    expect((await selectReviewInvite(testDb, MONDAY_2359))?.weekStart).toBe(WEEK);
  });
});

describe("getReviewInvite", () => {
  test("the owner reads it", async () => {
    expect((await getReviewInvite(SUNDAY_1800))?.weekStart).toBe(WEEK);
    expect(await getReviewInvite(SUNDAY_1759)).toBeNull();
  });

  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s it redirects to /login", async (_name, headers) => {
    // Positive control: the owner reads it.
    expect(await getReviewInvite(SUNDAY_1800)).not.toBeNull();
    request.headers = await headers();
    await expect(getReviewInvite(SUNDAY_1800)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
