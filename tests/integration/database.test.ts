import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import journal from "../../drizzle/meta/_journal.json";
import { seed } from "../../scripts/seed";
import { testDb } from "./test-db";

const area = (slug: string) => ({ slug, name: slug, icon: "house", color: "home" }) as const;

describe("migrations", () => {
  test("apply on an empty database", async () => {
    // global-setup drops everything and runs every migration before the suite.
    const applied = await testDb.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]).toEqual({ n: journal.entries.length });
    const table = await testDb.execute(sql`select to_regclass('public.core_life_areas') as name`);
    expect(table.rows[0]).toEqual({ name: "core_life_areas" });
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
});

describe("core_life_areas", () => {
  test("enforces unique slugs", async () => {
    await testDb.insert(lifeAreas).values(area("music"));
    await expect(testDb.insert(lifeAreas).values(area("music"))).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505" }),
    });
  });

  test("updates updatedAt on update", async () => {
    const [created] = await testDb.insert(lifeAreas).values(area("music")).returning();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [updated] = await testDb
      .update(lifeAreas)
      .set({ name: "Música" })
      .where(eq(lifeAreas.id, created.id))
      .returning();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect(updated.createdAt).toEqual(created.createdAt);
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
});
