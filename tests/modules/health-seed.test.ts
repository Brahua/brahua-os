// E1 of `health`: the catalogue's seed is written once (src/modules/health/seed.ts) and migration
// 0029 inserts exactly those rows. This test parses the migration's INSERT and fails if the two
// drift (a row added, renamed or changed on one side only), and checks the seed itself: 64
// exercises (SPEC-health "Anexo"), stable unique keys, unique names without case or accents, and
// values the CHECKs accept.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  EQUIPMENT,
  EXERCISE_KINDS,
  EXERCISE_NAME_MAX_LENGTH,
  MUSCLE_GROUPS,
} from "@/modules/health/health-constants";
import { exerciseIdInputSchema } from "@/modules/health/exercises-input";
import { exerciseNameKey } from "@/modules/health/name-key";
import { SEED_EXERCISES } from "@/modules/health/seed";

const MIGRATION = path.join(process.cwd(), "drizzle/0029_health_catalog.sql");

/** The VALUES rows of the seed's INSERT, as fields. */
function migrationRows() {
  const sql = readFileSync(MIGRATION, "utf8");
  const insert = sql.slice(sql.indexOf('INSERT INTO "health_exercises"'));
  expect(insert).toContain(
    '("id", "seed_key", "name", "name_key", "kind", "muscle_group", "equipment", "per_dumbbell")',
  );
  expect(insert.trimEnd().endsWith("ON CONFLICT DO NOTHING;")).toBe(true);
  const row =
    /\(md5\('health:exercise:([^']+)'\)::uuid, '([^']+)', '((?:[^']|'')+)', '((?:[^']|'')+)', '([^']+)', '([^']+)', '([^']+)', (true|false)\)/g;
  return [...insert.matchAll(row)].map((match) => ({
    idKey: match[1],
    seedKey: match[2],
    name: match[3].replaceAll("''", "'"),
    nameKey: match[4].replaceAll("''", "'"),
    kind: match[5],
    muscleGroup: match[6],
    equipment: match[7],
    perDumbbell: match[8] === "true",
  }));
}

describe("the catalogue's seed", () => {
  test("has the 64 exercises of the spec, by group", () => {
    expect(SEED_EXERCISES).toHaveLength(64);
    const byGroup = (groups: string[]) =>
      SEED_EXERCISES.filter((exercise) => groups.includes(exercise.muscleGroup)).length;
    expect(byGroup(["chest"])).toBe(10);
    expect(byGroup(["back"])).toBe(9);
    expect(byGroup(["shoulders"])).toBe(7);
    expect(byGroup(["biceps"])).toBe(5);
    expect(byGroup(["triceps"])).toBe(5);
    expect(byGroup(["quads", "hamstrings", "glutes", "calves"])).toBe(16);
    expect(byGroup(["abs"])).toBe(6);
    expect(byGroup(["cardio"])).toBe(6);
  });

  test("keys and names are unique (names without case or accents) and fit the CHECKs", () => {
    expect(new Set(SEED_EXERCISES.map((e) => e.seedKey)).size).toBe(64);
    expect(new Set(SEED_EXERCISES.map((e) => exerciseNameKey(e.name))).size).toBe(64);
    for (const exercise of SEED_EXERCISES) {
      expect(exercise.seedKey).toMatch(/^[a-z0-9_]+$/);
      expect([...exercise.name].length).toBeLessThanOrEqual(EXERCISE_NAME_MAX_LENGTH);
      expect(EXERCISE_KINDS).toContain(exercise.kind);
      expect(MUSCLE_GROUPS).toContain(exercise.muscleGroup);
      expect(EQUIPMENT).toContain(exercise.equipment);
      // «Por mancuerna» only on dumbbells; cardio is measured as cardio.
      if (exercise.perDumbbell) expect(exercise.equipment).toBe("dumbbell");
      expect(exercise.muscleGroup === "cardio").toBe(exercise.kind === "cardio");
    }
  });

  test("migration 0029 inserts exactly the rows of seed.ts, in order", () => {
    const rows = migrationRows();
    expect(rows).toEqual(
      SEED_EXERCISES.map((exercise) => ({
        idKey: exercise.seedKey,
        seedKey: exercise.seedKey,
        name: exercise.name,
        nameKey: exerciseNameKey(exercise.name),
        kind: exercise.kind,
        muscleGroup: exercise.muscleGroup,
        equipment: exercise.equipment,
        perDumbbell: exercise.perDumbbell,
      })),
    );
  });

  test("positive control: one changed field on either side is a mismatch", () => {
    const rows = migrationRows();
    expect(rows[0]).toMatchObject({
      seedKey: "barbell_bench_press",
      name: "Press de banca con barra",
    });
    const renamed = rows.map((row, index) => (index === 10 ? { ...row, name: "Dominada" } : row));
    expect(renamed).not.toEqual(rows);
    expect(rows.slice(1)).not.toEqual(rows);
  });
});

describe("the seeded ids", () => {
  // md5('health:exercise:<key>')::uuid, as migration 0029 writes them.
  const seedId = (seedKey: string) => {
    const hex = createHash("md5").update(`health:exercise:${seedKey}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  test("every one passes the module's id validation, though most carry no RFC version bits", () => {
    const ids = SEED_EXERCISES.map((exercise) => seedId(exercise.seedKey));
    const refused = ids.filter((id) => !exerciseIdInputSchema.safeParse({ id }).success);
    expect(refused).toEqual([]);
    // Positive control: a strict uuid check refuses most of them (the bug the E2E found).
    expect(ids.filter((id) => !z.uuid().safeParse(id).success).length).toBeGreaterThan(0);
  });
});
