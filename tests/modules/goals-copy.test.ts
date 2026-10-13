// G1 of `goals`: the copy has no guilt (SPEC-goals "Estrategia de pruebas", "Ritmo sin culpa").
// Scans EVERY string exported by goals-copy.ts, and what its functions return, for the words the
// module never says. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import * as copy from "@/modules/goals/goals-copy";
import { paceLine } from "@/modules/goals/goal-text";
import type { Pace } from "@/modules/goals/pace";

const FORBIDDEN = ["atrasad", "riesgo", "fallaste", "deuda", "⚠️", "racha perdida"];

/** Sample arguments for the copy's functions: a title, numbers and a unit. */
const SAMPLES = ["Leer 12 libros", 3, 12, "libros", "T4 2026", 5];

/** Every string in `value`: strings, what functions return for sample arguments, nested objects. */
function collect(value: unknown, path: string, into: [string, string][]) {
  if (typeof value === "string") into.push([path, value]);
  else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    // Called with each sample in the first slot too, so a function that formats a number or a
    // string gets both.
    for (const first of [SAMPLES[0], SAMPLES[1]]) {
      const args = [first, ...SAMPLES.slice(1)].slice(0, Math.max(fn.length, 1));
      collect(fn(...args), `${path}()`, into);
    }
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) collect(inner, `${path}.${key}`, into);
  }
}

function allStrings(): [string, string][] {
  const found: [string, string][] = [];
  for (const [name, value] of Object.entries(copy)) collect(value, name, found);
  return found;
}

function offenders(strings: [string, string][]) {
  return strings.filter(([, text]) =>
    FORBIDDEN.some((word) => text.toLowerCase().includes(word.toLowerCase())),
  );
}

describe("goals copy has no guilt", () => {
  test("it scans a real amount of copy", () => {
    expect(allStrings().length).toBeGreaterThan(150);
  });

  test("no string says atrasad…, riesgo, fallaste, deuda, ⚠️ or racha perdida", () => {
    expect(offenders(allStrings())).toEqual([]);
  });

  test("positive control: the scan does flag a forbidden word", () => {
    const planted: [string, string][] = [
      ["a", "Vas atrasada con tu meta"],
      ["b", "Estás en riesgo"],
      ["c", "⚠️ Cuidado"],
      ["d", "Perdiste tu racha perdida"],
      ["e", "Esta es tu DEUDA"],
      ["f", "Fallaste otra vez"],
    ];
    expect(offenders(planted).map(([key]) => key)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(offenders([["ok", "Para llegar: ~3 libros por semana"]])).toEqual([]);
  });

  test("the pace lines are the ones SPEC-goals names", () => {
    const line = (pace: Pace) => paceLine(pace, "libros", "2026-01-01");
    expect(line({ kind: "ahead", by: 2 })).toBe("Vas 2 por delante de tu ritmo");
    expect(line({ kind: "on" })).toBe("Vas a tu ritmo");
    expect(line({ kind: "next-step", perWeekNeeded: 3, remaining: 9 })).toBe(
      "Para llegar: ~3 libros por semana",
    );
    expect(line({ kind: "done" })).toBe("Meta lograda");
    expect(line({ kind: "past" })).toBeNull();
    expect(line({ kind: "upcoming" })).toMatch(/^Empieza el /);
  });
});
