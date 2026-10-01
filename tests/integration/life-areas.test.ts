import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { createLifeArea, updateLifeArea } from "@/modules/core/actions";
import { lifeAreas } from "@/modules/core/db/schema";
import { LIFE_AREA_ERRORS } from "@/modules/core/life-area-input";
import { insertLifeArea, isSlugConflict } from "@/modules/core/life-areas";
import { listLifeAreas } from "@/modules/core/queries";
import { seed } from "@/modules/core/seed";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

// The actions read the request headers (session cookie) and the app database: point both at
// the test, and record revalidations instead of touching Next's cache.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

const music = { name: "Música", color: "hobbies", icon: "music" } as const;

async function allAreas() {
  return testDb.select().from(lifeAreas).orderBy(asc(lifeAreas.sortOrder));
}

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

describe("createLifeArea", () => {
  test("creates the area with a slug from its name and revalidates /areas", async () => {
    const result = await createLifeArea({ ...music, name: "  Música   en  vivo " });

    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        slug: "musica-en-vivo",
        name: "Música en vivo",
        color: "hobbies",
        icon: "music",
        sortOrder: 0,
      },
    });
    const [row] = await allAreas();
    expect(row).toMatchObject({ slug: "musica-en-vivo", name: "Música en vivo", archivedAt: null });
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("puts new areas at the end: sortOrder = max + 1, archived areas included", async () => {
    await seed(testDb); // sortOrder 0–7
    await testDb
      .update(lifeAreas)
      .set({ sortOrder: 20, archivedAt: new Date() })
      .where(eq(lifeAreas.slug, "travel"));

    const first = await createLifeArea(music);
    const second = await createLifeArea({ ...music, name: "Lectura", icon: "book-open" });

    expect(first.ok && first.data.sortOrder).toBe(21);
    expect(second.ok && second.data.sortOrder).toBe(22);
  });

  test("never reuses a seeded slug: “Home” becomes home-2, then home-3", async () => {
    await seed(testDb);

    const home = await createLifeArea({ name: "Home", color: "home", icon: "house" });
    const again = await createLifeArea({ name: "HOME!", color: "work", icon: "laptop" });

    expect(home.ok && home.data.slug).toBe("home-2");
    expect(again.ok && again.data.slug).toBe("home-3");
    // The seeded area is untouched.
    const [seeded] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));
    expect(seeded).toMatchObject({ name: "Hogar", sortOrder: 0 });
  });

  test("names without letters or digits get the fallback slug", async () => {
    const first = await createLifeArea({ ...music, name: "🎸" });
    const second = await createLifeArea({ ...music, name: "¡¡!!" });
    expect(first.ok && first.data.slug).toBe("area");
    expect(second.ok && second.data.slug).toBe("area-2");
  });

  test("concurrent creates with the same name get distinct slugs and positions", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createLifeArea({ ...music, name: "Música" })),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const rows = await allAreas();
    expect(rows.map((row) => row.slug).sort()).toEqual([
      "musica",
      "musica-2",
      "musica-3",
      "musica-4",
      "musica-5",
    ]);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  test("returns field errors for every invalid field and writes nothing", async () => {
    const result = await createLifeArea({ name: "   ", color: "red", icon: "skull" });

    expect(result).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: {
        name: [LIFE_AREA_ERRORS.nameRequired],
        color: [LIFE_AREA_ERRORS.color],
        icon: [LIFE_AREA_ERRORS.icon],
      },
    });
    expect(await testDb.$count(lifeAreas)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("rejects names over 60 characters (counted after trimming)", async () => {
    const tooLong = await createLifeArea({ ...music, name: "a".repeat(61) });
    expect(tooLong).toMatchObject({
      ok: false,
      fieldErrors: { name: [LIFE_AREA_ERRORS.nameTooLong] },
    });

    const padded = await createLifeArea({ ...music, name: `  ${"a".repeat(60)}  ` });
    expect(padded.ok).toBe(true);
  });

  test.each([undefined, null, "Música", 42, ["Música"]])(
    "rejects a malformed payload (%j)",
    async (payload) => {
      const result = await createLifeArea(payload);
      expect(result).toMatchObject({ ok: false, error: "Revisa los campos marcados." });
      expect(await testDb.$count(lifeAreas)).toBe(0);
    },
  );

  test("ignores fields it does not own (slug, sortOrder, archivedAt, id)", async () => {
    const result = await createLifeArea({
      ...music,
      id: "00000000-0000-4000-8000-000000000000",
      slug: "custom",
      sortOrder: 99,
      archivedAt: new Date().toISOString(),
    });
    expect(result.ok && result.data).toMatchObject({ slug: "musica", sortOrder: 0 });
    expect(result.ok && result.data.id).not.toBe("00000000-0000-4000-8000-000000000000");
    const [row] = await allAreas();
    expect(row.archivedAt).toBeNull();
  });
});

describe("updateLifeArea", () => {
  test("changes name, color and icon but keeps the slug and position", async () => {
    await seed(testDb);
    const [home] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));

    const result = await updateLifeArea({
      id: home.id,
      name: " Casa  y jardín ",
      color: "health",
      icon: "sprout",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: home.id,
        slug: "home",
        name: "Casa y jardín",
        color: "health",
        icon: "sprout",
        sortOrder: 0,
      },
    });
    const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, home.id));
    expect(row).toMatchObject({ slug: "home", name: "Casa y jardín", sortOrder: 0 });
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(home.updatedAt.getTime());
    expect(revalidatePath).toHaveBeenCalledWith("/areas");
  });

  test("returns field errors and leaves the area as it was", async () => {
    const created = await createLifeArea(music);
    if (!created.ok) throw new Error("setup failed");
    vi.mocked(revalidatePath).mockClear();

    const result = await updateLifeArea({ id: created.data.id, name: "", color: "x", icon: "" });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        name: [LIFE_AREA_ERRORS.nameRequired],
        color: [LIFE_AREA_ERRORS.color],
        icon: [LIFE_AREA_ERRORS.icon],
      },
    });
    const [row] = await allAreas();
    expect(row).toMatchObject({ name: "Música", color: "hobbies", icon: "music" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("an unknown or malformed id is an error, not an insert", async () => {
    const missing = await updateLifeArea({ ...music, id: "00000000-0000-4000-8000-000000000000" });
    expect(missing).toEqual({ ok: false, error: LIFE_AREA_ERRORS.id });

    const malformed = await updateLifeArea({ ...music, id: "home" });
    expect(malformed).toMatchObject({ ok: false, fieldErrors: { id: [LIFE_AREA_ERRORS.id] } });
    expect(await testDb.$count(lifeAreas)).toBe(0);
  });
});

describe("authorization", () => {
  async function expectRejected() {
    await seed(testDb);
    const [home] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));

    expect(await createLifeArea(music)).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await updateLifeArea({ ...music, id: home.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    // Invalid input is not even looked at: no field errors leak without a session.
    expect(await createLifeArea({})).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });

    expect(await testDb.$count(lifeAreas)).toBe(8);
    const [unchanged] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, home.id));
    expect(unchanged.name).toBe("Hogar");
    expect(revalidatePath).not.toHaveBeenCalled();
  }

  test("without a session, both actions are rejected", async () => {
    request.headers = new Headers();
    await expectRejected();
  });

  test("with a forged session cookie, both actions are rejected", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=forged.signature" });
    await expectRejected();
  });

  test("with a valid session of someone who is not the owner, both actions are rejected", async () => {
    // A session created while another address was the owner (e.g. OWNER_EMAIL changed).
    request.headers = new Headers({ cookie: await sessionCookieFor(OTHER) });
    await expectRejected();
  });
});

describe("listLifeAreas", () => {
  test("returns active areas in order, archived ones only when asked", async () => {
    await seed(testDb);
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: new Date() })
      .where(eq(lifeAreas.slug, "finance"));
    await createLifeArea(music);

    const active = await listLifeAreas();
    expect(active.map((area) => area.slug)).toEqual([
      "home",
      "health",
      "learning",
      "work",
      "relationships",
      "travel",
      "hobbies",
      "musica",
    ]);
    expect(Object.keys(active[0]).sort()).toEqual(
      ["color", "icon", "id", "name", "slug", "sortOrder"].sort(),
    );
    expect(await listLifeAreas({ includeArchived: true })).toHaveLength(9);
  });

  test("redirects to /login without an owner session", async () => {
    request.headers = new Headers();
    await expect(listLifeAreas()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});

describe("name hygiene", () => {
  test.each([
    ["NUL", "Mú\u0000sica"],
    ["zero-width space", "Mú​sica"],
    ["bidi override", "a‮b"],
  ])("a name with a %s is a field error, never a database error", async (_, name) => {
    const result = await createLifeArea({ ...music, name });
    expect(result).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { name: [LIFE_AREA_ERRORS.nameInvisible] },
    });
    expect(await testDb.$count(lifeAreas)).toBe(0);
  });
});

describe("CHECK constraints (defense in depth)", () => {
  const insert = (values: { name: string; color: string; icon: string }) =>
    testDb.execute(
      sql`insert into core_life_areas (slug, name, color, icon) values ('raw', ${values.name}, ${values.color}, ${values.icon})`,
    );

  test.each([
    ["an unknown color", { name: "x", color: "red", icon: "star" }, "core_life_areas_color_check"],
    ["an unknown icon", { name: "x", color: "work", icon: "skull" }, "core_life_areas_icon_check"],
    [
      "an empty name",
      { name: "", color: "work", icon: "star" },
      "core_life_areas_name_length_check",
    ],
    [
      "a 61-character name",
      { name: "a".repeat(61), color: "work", icon: "star" },
      "core_life_areas_name_length_check",
    ],
  ])("a raw insert with %s fails", async (_, values, constraint) => {
    await expect(insert(values)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23514", constraint }),
    });
    expect(await testDb.$count(lifeAreas)).toBe(0);
  });

  test("a valid raw insert (60 characters, any curated icon) passes", async () => {
    await insert({ name: "ñ".repeat(60), color: "hobbies", icon: "wrench" });
    expect(await testDb.$count(lifeAreas)).toBe(1);
  });
});

describe("slug race with writers that skip the lock", () => {
  test("isSlugConflict recognizes the unique violation on the slug only", async () => {
    await testDb.insert(lifeAreas).values({ slug: "x", name: "x", icon: "star", color: "work" });
    const error = await testDb
      .insert(lifeAreas)
      .values({ slug: "x", name: "x", icon: "star", color: "work" })
      .catch((caught: unknown) => caught);
    expect(isSlugConflict(error)).toBe(true);
    expect(isSlugConflict(new Error("boom"))).toBe(false);
    expect(isSlugConflict({ code: "23505", constraint: "other_unique" })).toBe(false);
  });

  test("retries when the slug is taken between the check and the insert", async () => {
    // A writer that skips the lock (like the seed) has inserted `musica` but not committed yet:
    // the action does not see it, picks `musica` and waits on the unique index. Once the other
    // writer commits, the insert fails with a unique violation and the retry picks musica-2.
    const other = await testDb.$client.connect();
    try {
      await other.query("begin");
      await other.query(
        "insert into core_life_areas (slug, name, icon, color) values ('musica', 'Otra', 'star', 'work')",
      );
      const pending = insertLifeArea(testDb, music);
      await vi.waitFor(
        async () => {
          const waiting = await testDb.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_locks where not granted`,
          );
          expect(waiting.rows[0].n).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
      await other.query("commit");

      const area = await pending;
      expect(area.slug).toBe("musica-2");
    } finally {
      other.release();
    }
    expect((await allAreas()).map((row) => row.slug).sort()).toEqual(["musica", "musica-2"]);
  });
});
