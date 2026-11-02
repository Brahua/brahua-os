// L1 of `learning`: the copy has no guilt (SPEC-learning "Tono", "Estrategia de pruebas"). Scans
// EVERY string exported by every `*-copy.ts` file of the module (L2 and L3 add theirs: the glob
// picks them up) and what their functions return. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import { LEARNING_COPY } from "@/modules/learning/learning-copy";

const FORBIDDEN = [
  "atrasad",
  "riesgo",
  "fallaste",
  "deuda",
  "⚠️",
  "racha perdida",
  "pendiente de culpa",
  "debiste",
];

const copyModules = import.meta.glob("../../src/modules/learning/*-copy.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

/** Sample arguments: a title, numbers and a day. */
const SAMPLES = ["AWS SAA", 3, 40, "2026-12-15"];

function collect(value: unknown, path: string, into: [string, string][]) {
  if (typeof value === "string") into.push([path, value]);
  else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    for (const first of [SAMPLES[0], SAMPLES[1]]) {
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

describe("learning copy has no guilt", () => {
  test("it finds the copy files and scans their strings", () => {
    const files = Object.keys(copyModules);
    expect(files.some((file) => file.endsWith("learning-copy.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("steps-copy.ts"))).toBe(true);
    const scanned = allStrings().map(([, text]) => text);
    expect(scanned.length).toBeGreaterThan(100);
    for (const expected of ["¿Qué quieres aprender?", "Nuevo frente", "Hecho", "Pegar temario"]) {
      expect(scanned).toContain(expected);
    }
  });

  test("none of it says the forbidden words, the pace sentences included", () => {
    expect(offenders(allStrings())).toEqual([]);
    const sentences: [string, string][] = [
      ["perWeek", LEARNING_COPY.pace({ kind: "perWeek", perWeek: 4, targetDate: "2026-12-15" })],
      ["passed", LEARNING_COPY.pace({ kind: "passed", targetDate: "2026-10-01" })],
    ];
    expect(offenders(sentences)).toEqual([]);
  });

  test("positive control: the scan finds a forbidden word", () => {
    expect(
      offenders([
        ["x", "Vas atrasado con AWS"],
        ["y", "Fallaste la semana"],
        ["z", "Para llegar: ~4 pasos por semana"],
      ]).map(([key]) => key),
    ).toEqual(["x", "y"]);
  });
});
