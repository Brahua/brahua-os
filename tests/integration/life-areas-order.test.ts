// C6: reorder, archive and unarchive life areas (and the undo paths the UI uses), against the
// real database.
import { asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import {
  archiveLifeArea,
  createLifeArea,
  reorderLifeAreas,
  unarchiveLifeArea,
  updateLifeArea,
} from "@/modules/core/actions";
import { lifeAreas } from "@/modules/core/db/schema";
import { LIFE_AREA_ERRORS } from "@/modules/core/life-area-input";
import { listArchivedLifeAreas, listLifeAreas } from "@/modules/core/queries";
import { seed } from "@/modules/core/seed";
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
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const SEEDED = [
  "home",
  "health",
  "finance",
  "learning",
  "work",
  "relationships",
  "travel",
  "hobbies",
];

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  await seed(testDb); // sortOrder 0–7
});

/** Every area by position: slug, sort_order and whether it is archived. */
async function rows() {
  const all = await testDb
    .select()
    .from(lifeAreas)
    .orderBy(asc(lifeAreas.sortOrder), asc(lifeAreas.createdAt));
  return all.map((row) => ({
    slug: row.slug,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
  }));
}

async function idsBySlug(): Promise<Record<string, string>> {
  const all = await testDb.select({ id: lifeAreas.id, slug: lifeAreas.slug }).from(lifeAreas);
  return Object.fromEntries(all.map((row) => [row.slug, row.id]));
}

async function activeIds(): Promise<string[]> {
  const active = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(isNull(lifeAreas.archivedAt))
    .orderBy(asc(lifeAreas.sortOrder));
  return active.map((row) => row.id);
}

/** sort_order is unique and contiguous (0…n-1) over all areas. */
async function expectContiguous() {
  const orders = (await rows()).map((row) => row.sortOrder);
  expect(orders).toEqual(orders.map((_, index) => index));
}

describe("reorderLifeAreas", () => {
  test("writes the new order in one go, with contiguous sort_order, and revalidates", async () => {
    const ids = await idsBySlug();
    const order = ["hobbies", "home", "work", "health", "finance", "learning", "travel"];
    const result = await reorderLifeAreas({
      ids: [...order.slice(0, 3), "relationships", ...order.slice(3)].map((slug) => ids[slug]),
    });

    expect(result.ok).toBe(true);
    const expected = [
      "hobbies",
      "home",
      "work",
      "relationships",
      "health",
      "finance",
      "learning",
      "travel",
    ];
    expect(result.ok && result.data.map((area) => area.slug)).toEqual(expected);
    expect(result.ok && result.data.map((area) => area.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect((await listLifeAreas()).map((area) => area.slug)).toEqual(expected);
    await expectContiguous();
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("only touches the rows that move", async () => {
    const before = await testDb.select().from(lifeAreas);
    const ids = await activeIds();
    // Swap the last two.
    await reorderLifeAreas({ ids: [...ids.slice(0, 6), ids[7], ids[6]] });
    const after = await testDb.select().from(lifeAreas);
    const changed = after.filter(
      (row) =>
        row.updatedAt.getTime() !== before.find((old) => old.id === row.id)!.updatedAt.getTime(),
    );
    expect(changed.map((row) => row.slug).sort()).toEqual(["hobbies", "travel"]);
  });

  test("archived areas keep their places; the active ones fill the rest", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.finance });
    await archiveLifeArea({ id: ids.home });
    const active = await activeIds();

    const result = await reorderLifeAreas({ ids: [...active].reverse() });

    expect(result.ok).toBe(true);
    expect(await rows()).toEqual([
      // Archived: home was 0 and finance 2, and so they stay.
      { slug: "home", sortOrder: 0, archived: true },
      { slug: "hobbies", sortOrder: 1, archived: false },
      { slug: "finance", sortOrder: 2, archived: true },
      { slug: "travel", sortOrder: 3, archived: false },
      { slug: "relationships", sortOrder: 4, archived: false },
      { slug: "work", sortOrder: 5, archived: false },
      { slug: "learning", sortOrder: 6, archived: false },
      { slug: "health", sortOrder: 7, archived: false },
    ]);
  });

  test("a stale list (an area created since) is rejected, writes nothing and revalidates", async () => {
    const stale = await activeIds();
    await createLifeArea({ name: "Música", color: "hobbies", icon: "music" });
    vi.mocked(revalidatePath).mockClear();
    const before = await rows();

    const result = await reorderLifeAreas({ ids: [...stale].reverse() });

    expect(result).toEqual({ ok: false, error: LIFE_AREA_ERRORS.staleOrder });
    expect(await rows()).toEqual(before);
    // The response carries the current list.
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("a stale list (an area archived since) is rejected", async () => {
    const stale = await activeIds();
    await archiveLifeArea({ id: stale[3] });
    const result = await reorderLifeAreas({ ids: stale });
    expect(result).toEqual({ ok: false, error: LIFE_AREA_ERRORS.staleOrder });
  });

  test.each([
    ["an archived id instead of an active one", "archived"],
    ["an unknown id", "unknown"],
    ["an active area left out", "missing"],
  ] as const)("a tampered list (%s) is rejected and writes nothing", async (_, kind) => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.travel });
    const active = await activeIds();
    const before = await rows();
    const tampered =
      kind === "archived"
        ? [...active.slice(1), ids.travel]
        : kind === "unknown"
          ? [...active.slice(1), MISSING_ID]
          : active.slice(1);

    const result = await reorderLifeAreas({ ids: tampered });

    expect(result).toEqual({ ok: false, error: LIFE_AREA_ERRORS.staleOrder });
    expect(await rows()).toEqual(before);
  });

  test.each([
    ["duplicates", (ids: string[]) => ({ ids: [...ids.slice(0, 7), ids[0]] })],
    ["a malformed id", (ids: string[]) => ({ ids: [...ids.slice(0, 7), "home"] })],
    ["an empty list", () => ({ ids: [] })],
    ["no list", () => ({})],
    ["a string", () => ({ ids: "a,b" })],
    ["too many ids", () => ({ ids: Array.from({ length: 501 }, () => MISSING_ID) })],
  ])("malformed input (%s) is a validation error", async (_, build) => {
    const before = await rows();
    const result = await reorderLifeAreas(build(await activeIds()));
    expect(result).toMatchObject({ ok: false, error: INVALID_FIELDS_MESSAGE });
    // Errors on the list or one of its items ("ids.7"), always the same message.
    const fieldErrors = Object.entries((!result.ok && result.fieldErrors) || {});
    expect(fieldErrors.length).toBeGreaterThan(0);
    for (const [path, messages] of fieldErrors) {
      expect(path).toMatch(/^ids(\.\d+)?$/);
      expect(new Set(messages)).toEqual(new Set([LIFE_AREA_ERRORS.order]));
    }
    expect(await rows()).toEqual(before);
  });

  test("undo: reordering back to the previous list restores it", async () => {
    const previous = await activeIds();
    await reorderLifeAreas({ ids: [previous[2], ...previous.filter((_, i) => i !== 2)] });
    const undo = await reorderLifeAreas({ ids: previous });
    expect(undo.ok).toBe(true);
    expect((await rows()).map((row) => row.slug)).toEqual(SEEDED);
    await expectContiguous();
  });

  test("a create waiting on the lock lands after the reordered list (unique, contiguous)", async () => {
    const ids = await activeIds();
    // Hold the lock from another connection, so both actions queue behind it in a known order.
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtext('core_life_areas'))");
      const reorder = reorderLifeAreas({ ids: [...ids].reverse() });
      await waitForLockWaiters(1);
      const create = createLifeArea({ name: "Música", color: "hobbies", icon: "music" });
      await waitForLockWaiters(2);
      await holder.query("commit");

      const [reordered, created] = await Promise.all([reorder, create]);
      expect(reordered.ok).toBe(true);
      expect(created.ok && created.data.sortOrder).toBe(8);
    } finally {
      holder.release();
    }
    expect((await rows()).map((row) => row.slug)).toEqual([...SEEDED].reverse().concat("musica"));
    await expectContiguous();
  });

  test("concurrent reorders and creates never repeat a sort_order", async () => {
    const ids = await activeIds();
    const results = await Promise.all([
      reorderLifeAreas({ ids: [...ids].reverse() }),
      createLifeArea({ name: "Uno", color: "work", icon: "star" }),
      reorderLifeAreas({ ids: [ids[1], ids[0], ...ids.slice(2)] }),
      createLifeArea({ name: "Dos", color: "work", icon: "star" }),
    ]);
    // A reorder that ran after a create had a stale list: rejected, never half-applied.
    for (const result of [results[0], results[2]]) {
      if (!result.ok) expect(result.error).toBe(LIFE_AREA_ERRORS.staleOrder);
    }
    expect(results[1].ok && results[3].ok).toBe(true);
    expect(await testDb.$count(lifeAreas)).toBe(10);
    await expectContiguous();
  });
});

/** Waits until `count` connections are blocked on an advisory lock. */
async function waitForLockWaiters(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      "select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

describe("archiveLifeArea", () => {
  test("archives: out of the list, kept in the database with its position", async () => {
    const ids = await idsBySlug();
    const result = await archiveLifeArea({ id: ids.finance });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: ids.finance, slug: "finance", sortOrder: 2 }),
    });
    expect((await listLifeAreas()).map((area) => area.slug)).not.toContain("finance");
    expect((await listArchivedLifeAreas()).map((area) => area.slug)).toEqual(["finance"]);
    const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, ids.finance));
    expect(row.archivedAt).toBeInstanceOf(Date);
    expect(row.sortOrder).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("archiving twice is harmless; the archived list shows the latest first", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.home });
    await archiveLifeArea({ id: ids.work });
    const [first] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, ids.home));

    const again = await archiveLifeArea({ id: ids.home });

    expect(again.ok).toBe(true);
    const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, ids.home));
    expect(row.archivedAt).toEqual(first.archivedAt);
    expect((await listArchivedLifeAreas()).map((area) => area.slug)).toEqual(["work", "home"]);
  });

  test("an unknown or malformed id is an error", async () => {
    expect(await archiveLifeArea({ id: MISSING_ID })).toEqual({
      ok: false,
      error: LIFE_AREA_ERRORS.id,
    });
    expect(await archiveLifeArea({ id: "home" })).toMatchObject({
      ok: false,
      fieldErrors: { id: [LIFE_AREA_ERRORS.id] },
    });
    expect(await testDb.$count(lifeAreas, isNull(lifeAreas.archivedAt))).toBe(8);
  });

  test("a new area still goes after the archived ones (no repeated sort_order)", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.hobbies }); // sortOrder 7, the highest
    const created = await createLifeArea({ name: "Música", color: "hobbies", icon: "music" });
    expect(created.ok && created.data.sortOrder).toBe(8);
  });
});

describe("unarchiveLifeArea", () => {
  test("by default the area comes back at the end of the list", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.home });

    const result = await unarchiveLifeArea({ id: ids.home });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ slug: "home", sortOrder: 8 }),
    });
    const active = await listLifeAreas();
    expect(active.map((area) => area.slug)).toEqual([...SEEDED.slice(1), "home"]);
    expect(await listArchivedLifeAreas()).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("undo of an archive (position: original) puts it back where it was", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.learning });

    const result = await unarchiveLifeArea({ id: ids.learning, position: "original" });

    expect(result.ok && result.data.sortOrder).toBe(3);
    expect((await listLifeAreas()).map((area) => area.slug)).toEqual(SEEDED);
    await expectContiguous();
  });

  test("undo after a reorder still puts it back in its original place", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.home });
    const active = await activeIds();
    // Swap the first two active areas (health and finance).
    await reorderLifeAreas({ ids: [active[1], active[0], ...active.slice(2)] });

    await unarchiveLifeArea({ id: ids.home, position: "original" });

    expect((await listLifeAreas()).map((area) => area.slug)).toEqual([
      "home",
      "finance",
      "health",
      ...SEEDED.slice(3),
    ]);
    await expectContiguous();
  });

  test("undo of an unarchive archives it again", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.work });
    await unarchiveLifeArea({ id: ids.work });
    const undo = await archiveLifeArea({ id: ids.work });
    expect(undo.ok).toBe(true);
    expect((await listArchivedLifeAreas()).map((area) => area.slug)).toEqual(["work"]);
  });

  test("an active area stays as it is; unknown ids and positions are errors", async () => {
    const ids = await idsBySlug();
    const active = await unarchiveLifeArea({ id: ids.home });
    expect(active.ok && active.data.sortOrder).toBe(0);
    expect(await unarchiveLifeArea({ id: MISSING_ID })).toEqual({
      ok: false,
      error: LIFE_AREA_ERRORS.id,
    });
    expect(await unarchiveLifeArea({ id: ids.home, position: "top" })).toMatchObject({
      ok: false,
      fieldErrors: { position: [expect.any(String)] },
    });
    await expectContiguous();
  });
});

describe("editing archived areas", () => {
  test("is rejected until the area is unarchived (and the screen gets the fresh list)", async () => {
    const ids = await idsBySlug();
    await archiveLifeArea({ id: ids.travel });
    vi.mocked(revalidatePath).mockClear();
    const edit = { id: ids.travel, name: "Viajes", color: "travel", icon: "plane" };

    expect(await updateLifeArea(edit)).toEqual({ ok: false, error: LIFE_AREA_ERRORS.archived });
    const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, ids.travel));
    expect(row.name).toBe("Planes y Viajes");
    expect(revalidatePath).toHaveBeenCalledWith("/areas");

    await unarchiveLifeArea({ id: ids.travel });
    expect(await updateLifeArea(edit)).toMatchObject({ ok: true, data: { name: "Viajes" } });
  });
});

describe("authorization", () => {
  async function expectRejected() {
    const ids = await idsBySlug();
    const before = await rows();
    const unauthorized = { ok: false, error: UNAUTHORIZED_MESSAGE };

    expect(await reorderLifeAreas({ ids: Object.values(ids) })).toEqual(unauthorized);
    expect(await archiveLifeArea({ id: ids.home })).toEqual(unauthorized);
    expect(await unarchiveLifeArea({ id: ids.home })).toEqual(unauthorized);
    // Invalid input is not even looked at.
    expect(await reorderLifeAreas({ ids: "nope" })).toEqual(unauthorized);

    expect(await rows()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  }

  test("without a session, the actions are rejected", async () => {
    request.headers = new Headers();
    await expectRejected();
  });

  test("with a forged session cookie, the actions are rejected", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=forged.signature" });
    await expectRejected();
  });

  test("with a session of someone who is not the owner, the actions are rejected", async () => {
    request.headers = new Headers({ cookie: await sessionCookieFor(OTHER) });
    await expectRejected();
  });

  test("listArchivedLifeAreas redirects to /login without an owner session", async () => {
    request.headers = new Headers();
    await expect(listArchivedLifeAreas()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
