import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import journal from "../../drizzle/meta/_journal.json";
import { seed } from "../../scripts/seed";
import { migrateDatabase } from "./helpers";
import { testDb } from "./test-db";

const area = (slug: string) => ({ slug, name: slug, icon: "house", color: "home" }) as const;
const PAST = new Date("2000-01-01T00:00:00Z");

async function countMigrations() {
  const result = await testDb.execute<{ n: number }>(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  return result.rows[0].n;
}

describe("migrations", () => {
  test("apply on an empty database", async () => {
    // global-setup drops everything and runs every migration before the suite.
    expect(await countMigrations()).toBe(journal.entries.length);
    const table = await testDb.execute(sql`select to_regclass('public.core_life_areas') as name`);
    expect(table.rows[0]).toEqual({ name: "core_life_areas" });
  });

  test("running them again is a no-op", async () => {
    await migrateDatabase(testDb);
    expect(await countMigrations()).toBe(journal.entries.length);
  });
});

describe("seed", () => {
  test("creates the 8 default areas and is idempotent", async () => {
    expect(await seed(testDb)).toBe(8);
    expect(await seed(testDb)).toBe(0);

    const rows = await testDb.select().from(lifeAreas).orderBy(asc(lifeAreas.sortOrder));
    expect(rows.map((row) => row.slug)).toEqual([
      "home",
      "health",
      "finance",
      "learning",
      "work",
      "relationships",
      "travel",
      "hobbies",
    ]);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows.every((row) => row.color === row.slug)).toBe(true);
    expect(rows[1]).toMatchObject({ name: "Salud y Bienestar", icon: "heart-pulse" });
  });

  test("fills only missing slugs and never overwrites an existing area", async () => {
    await testDb
      .insert(lifeAreas)
      .values({ slug: "home", name: "Casa", icon: "tent", color: "travel", sortOrder: 5 });

    expect(await seed(testDb)).toBe(7);
    const [home] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));
    expect(home).toMatchObject({ name: "Casa", icon: "tent", color: "travel", sortOrder: 5 });
    expect(await testDb.$count(lifeAreas)).toBe(8);
  });
});

describe("core_life_areas", () => {
  test("enforces unique slugs", async () => {
    await testDb.insert(lifeAreas).values(area("music"));
    await expect(testDb.insert(lifeAreas).values(area("music"))).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505" }),
    });
  });

  test("Drizzle updates stamp updatedAt from the database clock", async () => {
    const [created] = await testDb
      .insert(lifeAreas)
      .values({ ...area("music"), createdAt: PAST, updatedAt: PAST })
      .returning();

    // now() is fixed for a whole transaction, so equality proves the database set the value
    // (a timestamp from the app server would not match it to the microsecond).
    const { updated, stampedByDb } = await testDb.transaction(async (tx) => {
      const [row] = await tx
        .update(lifeAreas)
        .set({ name: "Música" })
        .where(eq(lifeAreas.id, created.id))
        .returning();
      const result = await tx.execute<{ same: boolean }>(
        sql`select updated_at = now() as same from core_life_areas where id = ${created.id}`,
      );
      return { updated: row, stampedByDb: result.rows[0].same };
    });

    expect(stampedByDb).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(PAST.getTime());
    expect(updated.createdAt).toEqual(PAST);
  });

  test("raw SQL updates do not touch updatedAt (they must set it themselves)", async () => {
    const [created] = await testDb
      .insert(lifeAreas)
      .values({ ...area("music"), updatedAt: PAST })
      .returning();

    await testDb.execute(sql`update core_life_areas set name = 'Música' where id = ${created.id}`);

    const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, created.id));
    expect(row.name).toBe("Música");
    expect(row.updatedAt).toEqual(PAST);
  });
});

describe("transactions", () => {
  test("an interactive transaction commits all its writes", async () => {
    await testDb.transaction(async (tx) => {
      await tx.insert(lifeAreas).values(area("a"));
      const [inside] = await tx.select({ n: sql<number>`count(*)::int` }).from(lifeAreas);
      expect(inside.n).toBe(1);
      await tx.insert(lifeAreas).values(area("b"));
    });
    expect(await testDb.$count(lifeAreas)).toBe(2);
  });

  test("a thrown error rolls back every write", async () => {
    await expect(
      testDb.transaction(async (tx) => {
        await tx.insert(lifeAreas).values(area("a"));
        await tx.insert(lifeAreas).values(area("b"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await testDb.$count(lifeAreas)).toBe(0);
  });

  test("a database error (duplicate slug) rolls back every write", async () => {
    await expect(
      testDb.transaction(async (tx) => {
        await tx.insert(lifeAreas).values(area("a"));
        await tx.insert(lifeAreas).values(area("a"));
      }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23505" }) });
    expect(await testDb.$count(lifeAreas)).toBe(0);
  });
});
