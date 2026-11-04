// `health`: the copy has no guilt (SPEC-health "Tono", "Estrategia de pruebas"). Scans EVERY
// string exported by every `*-copy.ts` file of the module (E2–E4 add theirs: the glob picks them
// up) and what their functions return. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import { EXERCISE_ERRORS } from "@/modules/health/exercises-copy";
import { ROUTINES_COPY } from "@/modules/health/routines-copy";

// learning's list, plus «solo», «todavía», «perdiste» and «fallaste» (SPEC-health "Tono").
const FORBIDDEN = [
  "atrasad",
  "riesgo",
  "fallaste",
  "deuda",
  "⚠️",
  "racha perdida",
  "pendiente de culpa",
  "debiste",
  "solo",
  "todavía",
  "perdiste",
];

const copyModules = import.meta.glob("../../src/modules/health/*-copy.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

/** Sample arguments: a name, numbers. */
const SAMPLES = ["Rutina A", 3, 40, 12];

function collect(value: unknown, path: string, into: [string, string][]) {
  if (typeof value === "string") into.push([path, value]);
  else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    for (const first of [SAMPLES[0], SAMPLES[1], 0, 1]) {
      const args = [first, ...SAMPLES.slice(1)].slice(0, Math.max(fn.length, 1));
      collect(fn(...args), `${path}()`, into);
    }
  } else if (Array.isArray(value)) {
    value.forEach((inner, index) => collect(inner, `${path}[${index}]`, into));
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) collect(inner, `${path}.${key}`, into);
  }
}

function allStrings(): [string, string][] {
  const found: [string, string][] = [];
  for (const [file, exports] of Object.entries(copyModules)) {
    for (const [name, value] of Object.entries(exports)) collect(value, `${file}:${name}`, found);
  }
  return found;
}

const offenders = (strings: [string, string][]) =>
  strings.filter(([, text]) => FORBIDDEN.some((word) => text.toLowerCase().includes(word)));

describe("health copy has no guilt", () => {
  test("it finds the copy files and scans their strings", () => {
    const files = Object.keys(copyModules);
    for (const name of ["health-copy.ts", "exercises-copy.ts", "routines-copy.ts"]) {
      expect(files.some((file) => file.endsWith(name))).toBe(true);
    }
    const scanned = allStrings().map(([, text]) => text);
    expect(scanned.length).toBeGreaterThan(100);
    for (const expected of [
      "Arma tu primera rutina",
      "Nueva rutina",
      "Nuevo ejercicio",
      "Ya existe un ejercicio con ese nombre.",
      "Agregar ejercicio",
      "Peso corporal",
      "Isquiotibiales",
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  test("none of it says the forbidden words, the sentences with values included", () => {
    expect(offenders(allStrings())).toEqual([]);
    const sentences: [string, string][] = [
      ["inRoutine", EXERCISE_ERRORS.inRoutine("Rutina A")],
      ["count0", ROUTINES_COPY.exerciseCount(0)],
      ["count1", ROUTINES_COPY.exerciseCount(1)],
      ["full", ROUTINES_COPY.itemsFull],
    ];
    expect(offenders(sentences)).toEqual([]);
  });

  test("positive control: the scan finds a forbidden word", () => {
    expect(
      offenders([
        ["x", "Solo hiciste 2 series"],
        ["y", "Todavía no entrenaste"],
        ["z", "Perdiste la semana"],
        ["w", "4 × 8–10 · Descanso 2 min"],
      ]).map(([key]) => key),
    ).toEqual(["x", "y", "z"]);
  });
});
