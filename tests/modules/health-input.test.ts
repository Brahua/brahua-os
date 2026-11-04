// E1 of `health`: the pure pieces. The name key (search and uniqueness without case or accents),
// the Zod inputs of exercises and routines, which targets each kind needs, the item form ↔
// targets, the default routine name, how durations and targets read, and the optimistic view of a
// routine's exercises.
import { describe, expect, test } from "vitest";
import {
  createExerciseInputSchema,
  updateExerciseInputSchema,
} from "@/modules/health/exercises-input";
import { formatDuration, formatTargets, restChoices } from "@/modules/health/format";
import { exerciseNameKey, matchesSearch } from "@/modules/health/name-key";
import { applyItemChange } from "@/modules/health/routine-items-optimistic";
import {
  addItemInputSchema,
  defaultRoutineName,
  formToTargets,
  renameRoutineInputSchema,
  reorderItemsInputSchema,
  targetsProblem,
  targetsToForm,
  type RoutineItem,
} from "@/modules/health/routines-input";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("exerciseNameKey", () => {
  test("lowercase, without accents or marks, whitespace collapsed", () => {
    expect(exerciseNameKey("  Press de  Banca\tcon Barra ")).toBe("press de banca con barra");
    expect(exerciseNameKey("Extensión de cuádriceps")).toBe("extension de cuadriceps");
    expect(exerciseNameKey("PÁJAROS")).toBe("pajaros");
    expect(exerciseNameKey("Año")).toBe("ano");
    // A decomposed accent (a Mac may type it) gives the same key.
    expect(exerciseNameKey("Eli\u0301ptica")).toBe(exerciseNameKey("Elíptica"));
  });

  test("the search matches any part of the key, ignoring case and accents", () => {
    const key = exerciseNameKey("Sentadilla búlgara");
    expect(matchesSearch(key, "BULG")).toBe(true);
    expect(matchesSearch(key, "sentadilla bú")).toBe(true);
    expect(matchesSearch(key, "  ")).toBe(true);
    expect(matchesSearch(key, "press")).toBe(false);
  });
});

const EXERCISE = {
  name: "  Press  Arnold ",
  kind: "weight_reps",
  muscleGroup: "shoulders",
  equipment: "dumbbell",
  perDumbbell: true,
  restSeconds: 90,
};

describe("exercise inputs", () => {
  test("a valid exercise, its name normalized", () => {
    const parsed = createExerciseInputSchema.parse(EXERCISE);
    expect(parsed.name).toBe("Press Arnold");
  });

  test("each field refuses what the CHECKs would", () => {
    const issues = (values: Record<string, unknown>) => {
      const result = createExerciseInputSchema.safeParse({ ...EXERCISE, ...values });
      return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
    };
    expect(issues({ name: "   " })).toEqual(["name"]);
    expect(issues({ name: "x".repeat(81) })).toEqual(["name"]);
    expect(issues({ name: "x".repeat(80) })).toEqual([]);
    expect(issues({ name: "Press\u0000" })).toEqual(["name"]);
    expect(issues({ kind: "distance" })).toEqual(["kind"]);
    expect(issues({ muscleGroup: "neck" })).toEqual(["muscleGroup"]);
    expect(issues({ equipment: "rings" })).toEqual(["equipment"]);
    expect(issues({ restSeconds: 29 })).toEqual(["restSeconds"]);
    expect(issues({ restSeconds: 601 })).toEqual(["restSeconds"]);
    expect(issues({ restSeconds: 90.5 })).toEqual(["restSeconds"]);
    expect(issues({ restSeconds: 30 })).toEqual([]);
    expect(issues({ perDumbbell: "yes" })).toEqual(["perDumbbell"]);
  });

  test("a name of marks only (nothing left for its key) is refused as empty", () => {
    // Built from code points: a literal combining mark in the source would be invisible in review.
    const acute = String.fromCodePoint(0x301);
    const variation = String.fromCodePoint(0xfe0f);
    for (const name of [acute, variation, `${acute} ${acute}`]) {
      const result = createExerciseInputSchema.safeParse({ ...EXERCISE, name });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toBe("Ponle un nombre.");
    }
    // Positive control: a mark on a letter is fine.
    expect(
      createExerciseInputSchema.safeParse({ ...EXERCISE, name: `Pa${acute}jaros` }).success,
    ).toBe(true);
    expect(exerciseNameKey("İncline")).toBe("incline");
  });

  test("an update needs a uuid", () => {
    expect(updateExerciseInputSchema.safeParse({ ...EXERCISE, id: "x" }).success).toBe(false);
    expect(updateExerciseInputSchema.safeParse({ ...EXERCISE, id: id(1) }).success).toBe(true);
  });
});

const TARGETS = { targetSets: 4, repsMin: 8, repsMax: 10, targetSeconds: null, restSeconds: null };

describe("routine inputs", () => {
  test("a routine's name: 1–60, normalized", () => {
    expect(renameRoutineInputSchema.parse({ id: id(1), name: " Rutina  A " }).name).toBe(
      "Rutina A",
    );
    expect(renameRoutineInputSchema.safeParse({ id: id(1), name: "" }).success).toBe(false);
    expect(renameRoutineInputSchema.safeParse({ id: id(1), name: "x".repeat(61) }).success).toBe(
      false,
    );
  });

  test("an item's targets: ranges and the reps pair", () => {
    const issues = (values: Record<string, unknown>) => {
      const result = addItemInputSchema.safeParse({
        routineId: id(1),
        id: id(2),
        exerciseId: id(3),
        ...TARGETS,
        ...values,
      });
      return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
    };
    expect(issues({})).toEqual([]);
    expect(issues({ targetSets: 0 })).toEqual(["targetSets"]);
    expect(issues({ targetSets: 11 })).toEqual(["targetSets"]);
    expect(issues({ repsMin: 0 })).toEqual(["repsMin"]);
    expect(issues({ repsMax: 101 })).toEqual(["repsMax"]);
    expect(issues({ repsMin: 10, repsMax: 8 })).toEqual(["repsMax"]);
    expect(issues({ repsMin: 8, repsMax: 8 })).toEqual([]);
    expect(issues({ repsMax: null })).toEqual(["repsMax"]);
    expect(issues({ targetSeconds: 36_001, repsMin: null, repsMax: null })).toEqual([
      "targetSeconds",
    ]);
    expect(issues({ restSeconds: 20 })).toEqual(["restSeconds"]);
    expect(issues({ restSeconds: 120 })).toEqual([]);
  });

  test("which targets each kind needs", () => {
    const reps = { repsMin: 8, repsMax: 10, targetSeconds: null };
    const time = { repsMin: null, repsMax: null, targetSeconds: 30 };
    expect(targetsProblem("weight_reps", reps)).toBeNull();
    expect(targetsProblem("reps", reps)).toBeNull();
    expect(targetsProblem("weight_reps", time)).toBe("repsMin");
    expect(targetsProblem("reps", { ...reps, targetSeconds: 30 })).toBe("targetSeconds");
    expect(targetsProblem("time", time)).toBeNull();
    expect(targetsProblem("cardio", time)).toBeNull();
    expect(targetsProblem("time", reps)).toBe("targetSeconds");
    expect(targetsProblem("cardio", { ...time, repsMin: 8, repsMax: 8 })).toBe("repsMin");
  });

  test("a reorder is a set of at most 30 distinct uuids", () => {
    const ok = (ids: string[]) =>
      reorderItemsInputSchema.safeParse({ routineId: id(1), ids }).success;
    expect(ok([id(2), id(3)])).toBe(true);
    expect(ok([id(2), id(2)])).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok(Array.from({ length: 31 }, (_, n) => id(100 + n)))).toBe(false);
  });
});

describe("the item form", () => {
  test("round-trips reps, seconds and a cardio's minutes", () => {
    expect(targetsToForm("weight_reps", TARGETS)).toEqual({
      targetSets: "4",
      repsMin: "8",
      repsMax: "10",
      duration: "",
      restSeconds: "",
    });
    const cardio = {
      ...TARGETS,
      repsMin: null,
      repsMax: null,
      targetSeconds: 1_200,
      restSeconds: 60,
    };
    const form = targetsToForm("cardio", cardio);
    expect(form).toMatchObject({ duration: "20", restSeconds: "60" });
    expect(formToTargets("cardio", form)).toEqual({ ok: true, targets: cardio });
    expect(formToTargets("time", { ...form, duration: "45" })).toEqual({
      ok: true,
      targets: { ...cardio, targetSeconds: 45 },
    });
  });

  test("an empty maximum is one number; bad text is an error on its field", () => {
    const base = { targetSets: "3", repsMin: "8", repsMax: "", duration: "", restSeconds: "" };
    expect(formToTargets("reps", base)).toEqual({
      ok: true,
      targets: { targetSets: 3, repsMin: 8, repsMax: 8, targetSeconds: null, restSeconds: null },
    });
    const bad = formToTargets("weight_reps", { ...base, targetSets: "tres", repsMin: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(Object.keys(bad.errors).sort()).toEqual(["repsMax", "repsMin", "targetSets"]);
    const reversed = formToTargets("weight_reps", { ...base, repsMax: "6" });
    expect(reversed).toEqual({
      ok: false,
      errors: { repsMax: "El mínimo no puede pasar del máximo." },
    });
    const noTime = formToTargets("time", { ...base, duration: "0" });
    expect(noTime.ok === false && noTime.errors.targetSeconds).toBeTruthy();
  });
});

describe("defaultRoutineName", () => {
  test("the first free letter, without case; then numbers", () => {
    expect(defaultRoutineName([])).toBe("Rutina A");
    expect(defaultRoutineName(["Rutina A", "rutina b", "Piernas"])).toBe("Rutina C");
    const all = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `Rutina ${letter}`);
    expect(defaultRoutineName(all)).toBe("Rutina 27");
  });
});

describe("format", () => {
  test("durations and targets", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(3_900)).toBe("1 h 5 min");
    expect(formatTargets("weight_reps", TARGETS)).toBe("4 × 8–10");
    expect(formatTargets("reps", { ...TARGETS, repsMax: 8 })).toBe("4 × 8");
    expect(
      formatTargets("cardio", {
        targetSets: 1,
        repsMin: null,
        repsMax: null,
        targetSeconds: 1_200,
      }),
    ).toBe("1 × 20 min");
    expect(formatTargets("time", { ...TARGETS, repsMin: null, repsMax: null })).toBe("4 series");
    expect(restChoices(100)).toContain(100);
    expect(restChoices(90).filter((value) => value === 90)).toHaveLength(1);
  });
});

describe("applyItemChange", () => {
  const item = (n: number): RoutineItem => ({
    id: id(n),
    exerciseId: id(100 + n),
    exerciseName: `Ejercicio ${n}`,
    kind: "weight_reps",
    equipment: "barbell",
    perDumbbell: false,
    exerciseRestSeconds: 90,
    position: n,
    ...TARGETS,
  });
  const list = [item(0), item(1), item(2)];
  const order = (items: RoutineItem[]) => items.map((row) => [row.id, row.position]);

  test("add, update, remove, restore after its neighbour, reorder", () => {
    const added = applyItemChange(list, { type: "add", item: { ...item(3), position: 9 } });
    expect(order(added)).toEqual([0, 1, 2, 3].map((n) => [id(n), n]));
    expect(applyItemChange(added, { type: "add", item: item(3) })).toBe(added);
    const updated = applyItemChange(list, {
      type: "update",
      id: id(1),
      targets: { ...TARGETS, targetSets: 5 },
    });
    expect(updated[1].targetSets).toBe(5);
    const removed = applyItemChange(list, { type: "remove", id: id(1) });
    expect(order(removed)).toEqual([
      [id(0), 0],
      [id(2), 1],
    ]);
    const restored = applyItemChange(removed, {
      type: "restore",
      item: item(1),
      position: 1,
      afterId: id(0),
    });
    expect(order(restored)).toEqual(order(list));
    const reordered = applyItemChange(list, { type: "reorder", ids: [id(2), id(0), id(1)] });
    expect(order(reordered)).toEqual([
      [id(2), 0],
      [id(0), 1],
      [id(1), 2],
    ]);
  });
});
