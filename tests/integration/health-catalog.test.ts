// E1 of `health` against the throwaway database: the CHECKs, indexes and foreign keys of the four
// tables with raw inserts; the seed of migration 0029 run twice (still 64); the catalogue (a name
// unique among the live exercises without case or accents, a deleted one doesn't block; an exercise
// in a routine can't be deleted nor change between reps and time); the routines and their
// exercises (default names, targets by kind, the limit of 30, ids from another routine, remove and
// restore in place, reorders under the lock with stale lists refused); two saves at once;
// authorization of every action; and the export.
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { habits } from "@/modules/habits/db/schema";
import {
  healthExercises,
  healthRoutineExercises,
  healthRoutines,
  healthSettings,
} from "@/modules/health/db/schema";
import {
  createExercise,
  deleteExercise,
  restoreExercise,
  updateExercise,
} from "@/modules/health/exercises-actions";
import { HEALTH_ADVISORY_SPACE, HEALTH_ROUTINES_KEY } from "@/modules/health/lock-keys";
import {
  getExercise,
  getRoutine,
  listExercises,
  listRoutineItems,
  listRoutines,
} from "@/modules/health/queries";
import {
  addRoutineItem,
  createRoutine,
  deleteRoutine,
  removeRoutineItem,
  renameRoutine,
  reorderRoutineItems,
  reorderRoutines,
  restoreRoutine,
  restoreRoutineItem,
  updateRoutineItem,
} from "@/modules/health/routines-actions";
import { SEED_EXERCISES } from "@/modules/health/seed";
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
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const MISSING = "00000000-0000-4000-8000-0000000000ff";

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`action failed: ${JSON.stringify(result)}`);
  return result.data;
}

const EXERCISE = {
  name: "Sentadilla con barra",
  kind: "weight_reps",
  muscleGroup: "quads",
  equipment: "barbell",
  perDumbbell: false,
  restSeconds: 90,
} as const;

const exercise = async (values: Record<string, unknown> = {}) =>
  data(await createExercise({ ...EXERCISE, ...values }));

const REPS = { targetSets: 4, repsMin: 6, repsMax: 8, targetSeconds: null, restSeconds: 120 };
const TIME = { targetSets: 3, repsMin: null, repsMax: null, targetSeconds: 45, restSeconds: null };

const routine = async () => data(await createRoutine({}));
const addItem = async (routineId: string, exerciseId: string, targets: object = REPS) =>
  data(await addRoutineItem({ routineId, id: crypto.randomUUID(), exerciseId, ...targets }));

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

/** The seed's statement of migration 0029, as written there. */
function seedStatement(): string {
  const file = readFileSync(path.join(process.cwd(), "drizzle/0029_health_catalog.sql"), "utf8");
  const statement = file
    .split("--> statement-breakpoint")
    .find((part) => part.includes('INSERT INTO "health_exercises"'));
  if (!statement) throw new Error("no seed in 0029");
  return statement;
}

describe("CHECKs, indexes and foreign keys (raw inserts)", () => {
  const raw = (values: Partial<typeof healthExercises.$inferInsert>) => () =>
    testDb.insert(healthExercises).values({
      name: "Remo",
      nameKey: "remo",
      kind: "weight_reps",
      muscleGroup: "back",
      equipment: "barbell",
      ...values,
    } as typeof healthExercises.$inferInsert);
  const check = (constraint: string) => ({ code: "23514", constraint });

  test("exercises: names, enums and rest", async () => {
    expect(await violation(raw({}))).toBeNull();
    expect(await violation(raw({ name: "", nameKey: "x" }))).toEqual(
      check("health_exercises_name_check"),
    );
    expect(await violation(raw({ name: "x".repeat(81), nameKey: "y" }))).toEqual(
      check("health_exercises_name_check"),
    );
    expect(await violation(raw({ name: "Z", nameKey: "" }))).toEqual(
      check("health_exercises_name_key_check"),
    );
    expect(await violation(raw({ nameKey: "k", kind: "distance" as never }))).toEqual(
      check("health_exercises_kind_check"),
    );
    expect(await violation(raw({ nameKey: "k", muscleGroup: "neck" as never }))).toEqual(
      check("health_exercises_muscle_group_check"),
    );
    expect(await violation(raw({ nameKey: "k", equipment: "rings" as never }))).toEqual(
      check("health_exercises_equipment_check"),
    );
    expect(await violation(raw({ nameKey: "k", restSeconds: 29 }))).toEqual(
      check("health_exercises_rest_check"),
    );
    expect(await violation(raw({ nameKey: "k", restSeconds: 601 }))).toEqual(
      check("health_exercises_rest_check"),
    );
    // Positive controls at the bounds.
    expect(await violation(raw({ nameKey: "k30", restSeconds: 30 }))).toBeNull();
    expect(await violation(raw({ nameKey: "k600", restSeconds: 600 }))).toBeNull();
  });

  test("a name key is unique among the live ones (23505); a deleted one doesn't block", async () => {
    expect(await violation(raw({ nameKey: "press" }))).toBeNull();
    expect(await violation(raw({ nameKey: "press" }))).toEqual({
      code: "23505",
      constraint: "health_exercises_name_key_unique",
    });
    await testDb
      .update(healthExercises)
      .set({ deletedAt: new Date() })
      .where(eq(healthExercises.nameKey, "press"));
    expect(await violation(raw({ nameKey: "press" }))).toBeNull();
    // The seed key stays unique, deleted rows included.
    expect(await violation(raw({ nameKey: "s1", seedKey: "row" }))).toBeNull();
    await testDb
      .update(healthExercises)
      .set({ deletedAt: new Date() })
      .where(eq(healthExercises.seedKey, "row"));
    expect(await violation(raw({ nameKey: "s2", seedKey: "row" }))).toEqual({
      code: "23505",
      constraint: "health_exercises_seed_key_unique",
    });
  });

  test("routines and their exercises: names, targets, rest, position and foreign keys", async () => {
    const [ex] = await testDb
      .insert(healthExercises)
      .values({
        name: "Plancha",
        nameKey: "plancha",
        kind: "time",
        muscleGroup: "abs",
        equipment: "bodyweight",
      })
      .returning();
    expect(
      await violation(() => testDb.insert(healthRoutines).values({ name: "", position: 0 })),
    ).toEqual(check("health_routines_name_check"));
    expect(
      await violation(() => testDb.insert(healthRoutines).values({ name: "A", position: -1 })),
    ).toEqual(check("health_routines_position_check"));
    const [r] = await testDb.insert(healthRoutines).values({ name: "A", position: 0 }).returning();
    const item = (values: Partial<typeof healthRoutineExercises.$inferInsert>) => () =>
      testDb.insert(healthRoutineExercises).values({
        routineId: r.id,
        exerciseId: ex.id,
        position: 0,
        targetSets: 3,
        ...values,
      });
    expect(await violation(item({ repsMin: 8, repsMax: 10 }))).toBeNull();
    expect(await violation(item({ targetSeconds: 36_000, restSeconds: 600 }))).toBeNull();
    expect(await violation(item({}))).toBeNull();
    expect(await violation(item({ targetSets: 0 }))).toEqual(
      check("health_routine_exercises_sets_check"),
    );
    expect(await violation(item({ targetSets: 11 }))).toEqual(
      check("health_routine_exercises_sets_check"),
    );
    expect(await violation(item({ repsMin: 8 }))).toEqual(
      check("health_routine_exercises_reps_check"),
    );
    expect(await violation(item({ repsMin: 10, repsMax: 8 }))).toEqual(
      check("health_routine_exercises_reps_check"),
    );
    expect(await violation(item({ repsMin: 0, repsMax: 8 }))).toEqual(
      check("health_routine_exercises_reps_check"),
    );
    expect(await violation(item({ repsMin: 8, repsMax: 101 }))).toEqual(
      check("health_routine_exercises_reps_check"),
    );
    expect(await violation(item({ targetSeconds: 0 }))).toEqual(
      check("health_routine_exercises_seconds_check"),
    );
    expect(await violation(item({ targetSeconds: 36_001 }))).toEqual(
      check("health_routine_exercises_seconds_check"),
    );
    expect(await violation(item({ repsMin: 8, repsMax: 8, targetSeconds: 30 }))).toEqual(
      check("health_routine_exercises_target_check"),
    );
    expect(await violation(item({ restSeconds: 29 }))).toEqual(
      check("health_routine_exercises_rest_check"),
    );
    expect(await violation(item({ position: -1 }))).toEqual(
      check("health_routine_exercises_position_check"),
    );
    // A missing exercise is 23503; deleting a referenced one is RESTRICT (23001).
    expect(await violation(item({ exerciseId: MISSING }))).toMatchObject({ code: "23503" });
    expect(
      await violation(() => testDb.delete(healthExercises).where(eq(healthExercises.id, ex.id))),
    ).toMatchObject({ code: "23001" });
    expect(
      await violation(() => testDb.delete(healthRoutines).where(eq(healthRoutines.id, r.id))),
    ).toMatchObject({ code: "23001" });
  });

  test("the settings are one row, and their habit can't be deleted under them", async () => {
    const [habit] = await testDb
      .insert(habits)
      .values({
        name: "Gimnasio",
        measure: "check",
        frequency: "daily",
        startDate: "2026-11-01",
        sortOrder: 0,
      })
      .returning();
    expect(await violation(() => testDb.insert(healthSettings).values({ id: 1 }))).toBeNull();
    expect(await violation(() => testDb.insert(healthSettings).values({ id: 2 }))).toEqual(
      check("health_settings_single_row_check"),
    );
    await testDb.update(healthSettings).set({ habitId: habit.id }).where(eq(healthSettings.id, 1));
    expect(
      await violation(() => testDb.delete(habits).where(eq(habits.id, habit.id))),
    ).toMatchObject({ code: "23001" });
    expect(
      await violation(() => testDb.update(healthSettings).set({ habitId: MISSING })),
    ).toMatchObject({ code: "23503" });
  });
});

describe("the seed of migration 0029", () => {
  test("running it twice keeps the 64, with ids derived from their keys", async () => {
    // setup.ts empties the tables before each test: the migration's rows are gone here.
    expect(await listExercises()).toEqual([]);
    await testDb.execute(sql.raw(seedStatement()));
    await testDb.execute(sql.raw(seedStatement()));
    const rows = await testDb.select().from(healthExercises);
    expect(rows).toHaveLength(64);
    expect(new Set(rows.map((row) => row.seedKey))).toEqual(
      new Set(SEED_EXERCISES.map((seed) => seed.seedKey)),
    );
    const [{ id }] = await testDb
      .execute<{ id: string }>(sql`select md5('health:exercise:barbell_squat')::uuid::text as id`)
      .then((result) => result.rows);
    expect(rows.find((row) => row.seedKey === "barbell_squat")).toMatchObject({
      id,
      name: "Sentadilla con barra",
      restSeconds: 90,
      deletedAt: null,
    });
    // A seed exercise is like any other: renamed or deleted, the seed doesn't bring it back.
    await testDb
      .update(healthExercises)
      .set({ name: "Sentadilla trasera", nameKey: "sentadilla trasera" })
      .where(eq(healthExercises.id, id));
    await testDb.execute(sql.raw(seedStatement()));
    expect(await testDb.select().from(healthExercises)).toHaveLength(64);
    expect((await getExercise(id))?.name).toBe("Sentadilla trasera");
  });
});

describe("the catalogue", () => {
  test("creates one; the same name without case or accents is refused on its field", async () => {
    const created = await exercise({ name: "  Extensión de  cuádriceps " });
    expect(created).toMatchObject({
      name: "Extensión de cuádriceps",
      nameKey: "extension de cuadriceps",
    });
    expect(await createExercise({ ...EXERCISE, name: "EXTENSION DE CUADRICEPS" })).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { name: ["Ya existe un ejercicio con ese nombre."] },
    });
    // Deleted, it no longer blocks the name; restoring it then is refused (the name is taken).
    data(await deleteExercise({ id: created.id }));
    const again = await exercise({ name: "Extension de cuadriceps" });
    expect(await restoreExercise({ id: created.id })).toMatchObject({
      ok: false,
      error: "Ya existe un ejercicio con ese nombre.",
    });
    data(await deleteExercise({ id: again.id }));
    expect(data(await restoreExercise({ id: created.id }))).toMatchObject({ id: created.id });
    expect((await listExercises()).map((row) => row.name)).toEqual(["Extensión de cuádriceps"]);
    expect(revalidatePath).toHaveBeenCalledWith("/health", "layout");
  });

  test("edits every field; renaming to another's name is refused", async () => {
    const squat = await exercise();
    const press = await exercise({ name: "Press de banca", muscleGroup: "chest" });
    const edited = data(
      await updateExercise({
        id: press.id,
        ...EXERCISE,
        name: "Press de banca con mancuernas",
        muscleGroup: "chest",
        equipment: "dumbbell",
        perDumbbell: true,
        restSeconds: 120,
      }),
    );
    expect(edited).toMatchObject({ equipment: "dumbbell", perDumbbell: true, restSeconds: 120 });
    expect(
      await updateExercise({ id: press.id, ...EXERCISE, name: "sentadilla con BARRA" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { name: ["Ya existe un ejercicio con ese nombre."] },
    });
    // Its own name (another case) is fine.
    expect(
      data(await updateExercise({ id: squat.id, ...EXERCISE, name: "SENTADILLA CON BARRA" })).name,
    ).toBe("SENTADILLA CON BARRA");
    expect(await updateExercise({ id: MISSING, ...EXERCISE, name: "Otro" })).toMatchObject({
      ok: false,
      error: "Este ejercicio ya no existe (se eliminó). Ya ves el catálogo actual.",
    });
  });

  test("one in a live routine can't be deleted nor go from reps to time (its routine is named)", async () => {
    const squat = await exercise();
    const r = await routine();
    const added = await addItem(r.id, squat.id);
    const inRoutine = `Está en la rutina «${r.name}». Quítalo de ahí antes de eliminarlo o de cambiar cómo se mide.`;
    expect(await deleteExercise({ id: squat.id })).toEqual({ ok: false, error: inRoutine });
    expect(await updateExercise({ id: squat.id, ...EXERCISE, kind: "time" })).toEqual({
      ok: false,
      error: inRoutine,
    });
    // Within the same family it changes (weight_reps → reps).
    expect(data(await updateExercise({ id: squat.id, ...EXERCISE, kind: "reps" })).kind).toBe(
      "reps",
    );
    // Positive control: out of the routine, both go through.
    data(await removeRoutineItem({ routineId: r.id, id: added.id }));
    expect(data(await updateExercise({ id: squat.id, ...EXERCISE, kind: "time" })).kind).toBe(
      "time",
    );
    // The removal's «Deshacer» can't bring back reps targets onto a time exercise.
    const undo = { routineId: r.id, id: added.id, position: 0, afterId: null };
    expect(await restoreRoutineItem(undo)).toEqual({
      ok: false,
      error: "El ejercicio cambió cómo se mide, así que no puede volver con esos objetivos.",
    });
    expect(await listRoutineItems(r.id)).toEqual([]);
    expect(data(await deleteExercise({ id: squat.id }))).toEqual({
      id: squat.id,
      name: "Sentadilla con barra",
    });
    expect(await getExercise(squat.id)).toBeNull();
    // Deleted, its item can't come back either.
    expect(await restoreRoutineItem(undo)).toMatchObject({
      ok: false,
      error: "Ese ejercicio ya no está en el catálogo. Elige otro.",
    });
  });

  test("positive control: after a same-family change (weight_reps → reps) the item comes back", async () => {
    const squat = await exercise();
    const r = await routine();
    const added = await addItem(r.id, squat.id);
    data(await removeRoutineItem({ routineId: r.id, id: added.id }));
    data(await updateExercise({ id: squat.id, ...EXERCISE, kind: "reps" }));
    const back = data(
      await restoreRoutineItem({ routineId: r.id, id: added.id, position: 0, afterId: null }),
    );
    expect(back).toMatchObject([{ id: added.id, kind: "reps", repsMin: 6, repsMax: 8 }]);
  });

  test("a deleted routine whose exercise was deleted or measured another way stays deleted", async () => {
    const refusal = {
      ok: false,
      error:
        "Un ejercicio de la rutina cambió cómo se mide o se eliminó mientras tanto, así que la rutina no puede volver.",
    };
    // The exercise is deleted while the routine is (its live routines don't count it).
    const squat = await exercise();
    const a = await routine();
    await addItem(a.id, squat.id);
    data(await deleteRoutine({ id: a.id }));
    data(await deleteExercise({ id: squat.id }));
    expect(await restoreRoutine({ id: a.id })).toEqual(refusal);
    expect(await getRoutine(a.id)).toBeNull();
    // The exercise goes from reps to time while the routine is deleted.
    const row = await exercise({ name: "Remo con barra", muscleGroup: "back" });
    const b = await routine();
    await addItem(b.id, row.id);
    data(await deleteRoutine({ id: b.id }));
    data(await updateExercise({ id: row.id, ...EXERCISE, name: "Remo con barra", kind: "time" }));
    expect(await restoreRoutine({ id: b.id })).toEqual(refusal);
    expect(await getRoutine(b.id)).toBeNull();
    // Positive control: a same-family change (weight_reps → reps) restores fine.
    const press = await exercise({ name: "Press militar", muscleGroup: "shoulders" });
    const c = await routine();
    await addItem(c.id, press.id);
    data(await deleteRoutine({ id: c.id }));
    data(await updateExercise({ id: press.id, ...EXERCISE, name: "Press militar", kind: "reps" }));
    expect(data(await restoreRoutine({ id: c.id })).map((routine) => routine.id)).toEqual([c.id]);
    expect(await listRoutineItems(c.id)).toMatchObject([{ exerciseId: press.id, kind: "reps" }]);
  });

  test("reads never show an item whose exercise is deleted (the guard on the join)", async () => {
    const squat = await exercise();
    const r = await routine();
    await addItem(r.id, squat.id);
    // Only raw SQL (or a bug) gets here: the actions refuse it.
    await testDb
      .update(healthExercises)
      .set({ deletedAt: new Date() })
      .where(eq(healthExercises.id, squat.id));
    expect(await listRoutineItems(r.id)).toEqual([]);
    expect((await listRoutines())[0].exerciseCount).toBe(0);
  });

  test("two creates of one name at once: one is created, the other is told (control: two names)", async () => {
    const results = await Promise.all([
      createExercise({ ...EXERCISE, name: "Hip thrust" }),
      createExercise({ ...EXERCISE, name: "HIP THRUST" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const both = await Promise.all([
      createExercise({ ...EXERCISE, name: "Curl martillo" }),
      createExercise({ ...EXERCISE, name: "Curl predicador" }),
    ]);
    expect(both.every((result) => result.ok)).toBe(true);
  });
});

describe("routines", () => {
  test("«Nueva rutina» takes the next free letter, at the end; two at once get two", async () => {
    const [a, b] = await Promise.all([createRoutine({}), createRoutine({})]);
    expect([data(a).name, data(b).name].sort()).toEqual(["Rutina A", "Rutina B"]);
    data(await renameRoutine({ id: data(a).id, name: "Rutina C" }));
    // A and C exist (or B and C): the first free letter.
    const third = await routine();
    expect(["Rutina A", "Rutina B"]).toContain(third.name);
    expect((await listRoutines()).map((row) => row.position)).toEqual([0, 1, 2]);
  });

  test("renames; a deleted one is out of the list and back in its place with «Deshacer»", async () => {
    const a = await routine();
    const b = await routine();
    const c = await routine();
    expect(data(await renameRoutine({ id: b.id, name: " Piernas  " })).name).toBe("Piernas");
    data(await deleteRoutine({ id: b.id }));
    expect(await getRoutine(b.id)).toBeNull();
    expect((await listRoutines()).map((row) => [row.name, row.position])).toEqual([
      ["Rutina A", 0],
      ["Rutina C", 1],
    ]);
    expect(await renameRoutine({ id: b.id, name: "X" })).toMatchObject({ ok: false });
    const back = data(await restoreRoutine({ id: b.id }));
    expect(back.map((row) => [row.id, row.position])).toEqual([
      [a.id, 0],
      [b.id, 1],
      [c.id, 2],
    ]);
    // Twice changes nothing.
    expect(data(await restoreRoutine({ id: b.id }))).toHaveLength(3);
  });

  test("reorder: a stale or tampered list is refused without writing (control: the right one)", async () => {
    const a = await routine();
    const b = await routine();
    const c = await routine();
    expect(await reorderRoutines({ ids: [b.id, a.id] })).toMatchObject({
      ok: false,
      error: "La lista cambió mientras tanto. Ya ves la actual; vuelve a moverla.",
    });
    expect(await reorderRoutines({ ids: [b.id, a.id, MISSING] })).toMatchObject({ ok: false });
    expect(await reorderRoutines({ ids: [b.id, b.id, a.id] })).toMatchObject({ ok: false });
    expect((await listRoutines()).map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    const moved = data(await reorderRoutines({ ids: [c.id, a.id, b.id] }));
    expect(moved.map((row) => [row.id, row.position])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
  });

  test("a reorder waits for the routines lock (the first lock of the transaction)", async () => {
    const a = await routine();
    const b = await routine();
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HEALTH_ADVISORY_SPACE,
        HEALTH_ROUTINES_KEY,
      ]);
      let settled = false;
      const pending = reorderRoutines({ ids: [b.id, a.id] }).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await holder.query("commit");
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
    expect((await listRoutines()).map((row) => row.id)).toEqual([b.id, a.id]);
  });
});

describe("a routine's exercises", () => {
  test("added in order with targets that fit the kind; the wrong ones are refused on their field", async () => {
    const squat = await exercise();
    const plank = await exercise({
      name: "Plancha",
      kind: "time",
      muscleGroup: "abs",
      equipment: "bodyweight",
    });
    const r = await routine();
    const first = await addItem(r.id, squat.id);
    const second = await addItem(r.id, plank.id, TIME);
    // The same exercise may repeat.
    const third = await addItem(r.id, squat.id);
    expect((await listRoutineItems(r.id)).map((item) => [item.id, item.position])).toEqual([
      [first.id, 0],
      [second.id, 1],
      [third.id, 2],
    ]);
    expect(second).toMatchObject({
      exerciseName: "Plancha",
      kind: "time",
      targetSeconds: 45,
      exerciseRestSeconds: 90,
    });
    expect((await listRoutines())[0].exerciseCount).toBe(3);
    const wrong = await addRoutineItem({
      routineId: r.id,
      id: crypto.randomUUID(),
      exerciseId: plank.id,
      ...REPS,
    });
    expect(wrong).toMatchObject({
      ok: false,
      fieldErrors: { targetSeconds: [expect.any(String)] },
    });
    expect(await updateRoutineItem({ routineId: r.id, id: first.id, ...TIME })).toMatchObject({
      ok: false,
      fieldErrors: { repsMin: [expect.any(String)] },
    });
    expect(
      data(await updateRoutineItem({ routineId: r.id, id: first.id, ...REPS, targetSets: 5 })),
    ).toMatchObject({ targetSets: 5, repsMin: 6, repsMax: 8 });
    // A deleted exercise can't be added.
    const gone = await exercise({ name: "Remo" });
    data(await deleteExercise({ id: gone.id }));
    expect(
      await addRoutineItem({
        routineId: r.id,
        id: crypto.randomUUID(),
        exerciseId: gone.id,
        ...REPS,
      }),
    ).toMatchObject({ ok: false, error: "Ese ejercicio ya no está en el catálogo. Elige otro." });
  });

  test("at most 30 per routine", async () => {
    const squat = await exercise();
    const r = await routine();
    await testDb.insert(healthRoutineExercises).values(
      Array.from({ length: 30 }, (_, position) => ({
        routineId: r.id,
        exerciseId: squat.id,
        position,
        ...REPS,
      })),
    );
    expect(
      await addRoutineItem({
        routineId: r.id,
        id: crypto.randomUUID(),
        exerciseId: squat.id,
        ...REPS,
      }),
    ).toMatchObject({ ok: false, error: "Una rutina puede tener hasta 30 ejercicios." });
  });

  test("an item of another routine is «not found» (no IDOR across routines)", async () => {
    const squat = await exercise();
    const a = await routine();
    const b = await routine();
    const item = await addItem(a.id, squat.id);
    const notFound = "Este ejercicio ya no está en la rutina. Ya ves la rutina actual.";
    expect(await updateRoutineItem({ routineId: b.id, id: item.id, ...REPS })).toMatchObject({
      ok: false,
      error: notFound,
    });
    expect(await removeRoutineItem({ routineId: b.id, id: item.id })).toMatchObject({
      ok: false,
      error: notFound,
    });
    expect(await listRoutineItems(a.id)).toHaveLength(1);
    // A deleted routine takes no writes.
    data(await deleteRoutine({ id: a.id }));
    expect(
      await addRoutineItem({
        routineId: a.id,
        id: crypto.randomUUID(),
        exerciseId: squat.id,
        ...REPS,
      }),
    ).toMatchObject({
      ok: false,
      error: "Esta rutina ya no existe (se eliminó). Ya ves la lista actual.",
    });
  });

  test("removed and back in its place; reorders are checked as a set", async () => {
    const squat = await exercise();
    const r = await routine();
    const [a, b, c] = [
      await addItem(r.id, squat.id),
      await addItem(r.id, squat.id),
      await addItem(r.id, squat.id),
    ];
    const removed = data(await removeRoutineItem({ routineId: r.id, id: b.id }));
    expect(removed.position).toBe(1);
    expect((await listRoutineItems(r.id)).map((item) => [item.id, item.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    const back = data(
      await restoreRoutineItem({ routineId: r.id, id: b.id, position: 1, afterId: a.id }),
    );
    expect(back.map((item) => item.id)).toEqual([a.id, b.id, c.id]);
    // Twice changes nothing.
    expect(
      data(await restoreRoutineItem({ routineId: r.id, id: b.id, position: 1, afterId: a.id })),
    ).toHaveLength(3);
    expect(await reorderRoutineItems({ routineId: r.id, ids: [c.id, a.id] })).toMatchObject({
      ok: false,
    });
    expect(
      data(await reorderRoutineItems({ routineId: r.id, ids: [c.id, a.id, b.id] })).map((item) => [
        item.id,
        item.position,
      ]),
    ).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and every write is refused", async (_, headers) => {
    const squat = await exercise();
    const r = await routine();
    const item = await addItem(r.id, squat.id);
    // Positive control: the owner reads.
    expect(await listRoutines()).toHaveLength(1);

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listRoutines()).rejects.toMatchObject(redirect);
    await expect(getRoutine(r.id)).rejects.toMatchObject(redirect);
    await expect(listRoutineItems(r.id)).rejects.toMatchObject(redirect);
    await expect(listExercises()).rejects.toMatchObject(redirect);
    await expect(getExercise(squat.id)).rejects.toMatchObject(redirect);
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await createExercise({ ...EXERCISE, name: "Intruso" })).toEqual(refused);
    expect(await updateExercise({ id: squat.id, ...EXERCISE, name: "X" })).toEqual(refused);
    expect(await deleteExercise({ id: squat.id })).toEqual(refused);
    expect(await restoreExercise({ id: squat.id })).toEqual(refused);
    expect(await createRoutine({})).toEqual(refused);
    expect(await renameRoutine({ id: r.id, name: "X" })).toEqual(refused);
    expect(await deleteRoutine({ id: r.id })).toEqual(refused);
    expect(await restoreRoutine({ id: r.id })).toEqual(refused);
    expect(await reorderRoutines({ ids: [r.id] })).toEqual(refused);
    expect(
      await addRoutineItem({
        routineId: r.id,
        id: crypto.randomUUID(),
        exerciseId: squat.id,
        ...REPS,
      }),
    ).toEqual(refused);
    expect(
      await updateRoutineItem({ routineId: r.id, id: item.id, ...REPS, targetSets: 9 }),
    ).toEqual(refused);
    expect(await removeRoutineItem({ routineId: r.id, id: item.id })).toEqual(refused);
    expect(
      await restoreRoutineItem({ routineId: r.id, id: item.id, position: 0, afterId: null }),
    ).toEqual(refused);
    expect(await reorderRoutineItems({ routineId: r.id, ids: [item.id] })).toEqual(refused);
    // Nothing changed.
    expect(await testDb.select().from(healthExercises)).toHaveLength(1);
    expect(await testDb.select().from(healthRoutines)).toMatchObject([
      { name: r.name, deletedAt: null },
    ]);
    expect(await testDb.select().from(healthRoutineExercises)).toMatchObject([
      { targetSets: 4, deletedAt: null },
    ]);
  });
});

describe("export", () => {
  test("every exercise, routine and item is exported, deleted ones included", async () => {
    const squat = await exercise();
    const old = await exercise({ name: "Remo" });
    data(await deleteExercise({ id: old.id }));
    const r = await routine();
    await addItem(r.id, squat.id);
    const gone = await routine();
    data(await deleteRoutine({ id: gone.id }));
    await testDb.insert(healthSettings).values({ id: 1 });

    const exported = await buildExport(testDb, new Date("2026-11-04T15:00:00Z"));
    expect(
      exported.tables.health_exercises.rows
        .map((row) => [row.name, row.deleted_at !== null])
        .toSorted(),
    ).toEqual([
      ["Remo", true],
      ["Sentadilla con barra", false],
    ]);
    expect(exported.tables.health_routines.rowCount).toBe(2);
    expect(exported.tables.health_routine_exercises.rows).toMatchObject([
      { target_sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120 },
    ]);
    expect(exported.tables.health_settings.rows).toMatchObject([{ id: 1, habit_id: null }]);
  });
});
