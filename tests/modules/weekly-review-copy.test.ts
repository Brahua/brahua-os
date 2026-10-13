// W1 of `weekly-review`: the copy has no guilt (SPEC-weekly-review "Tono", "Estrategia de pruebas").
// Scans EVERY string exported by every `*-copy.ts` file of the module (W2 and W3 add theirs: the
// glob picks them up), and what their functions return, for the words the module never says. A
// positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import { weekLabel } from "@/modules/weekly-review/week";

const FORBIDDEN = ["atrasad", "riesgo", "fallaste", "deuda", "⚠️", "racha perdida"];

const copyModules = import.meta.glob("../../src/modules/weekly-review/*-copy.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

/** Sample arguments for the copy's functions: a title, numbers and a week. */
const SAMPLES = ["Leer 12 libros", 3, 12, "2026-10-12", 5];

/** Every string in `value`: strings, what functions return for sample arguments, nested objects. */
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
  // The week labels the screens print.
  for (const week of ["2026-10-12", "2026-12-28", "2028-02-28"]) {
    found.push([`weekLabel(${week})`, weekLabel(week)]);
  }
  return found;
}

function offenders(strings: [string, string][]) {
  return strings.filter(([, text]) =>
    FORBIDDEN.some((word) => text.toLowerCase().includes(word.toLowerCase())),
  );
}

describe("weekly-review copy has no guilt", () => {
  test("it finds the copy files and scans their strings", () => {
    expect(Object.keys(copyModules).some((file) => file.endsWith("review-copy.ts"))).toBe(true);
    expect(allStrings().length).toBeGreaterThan(10);
  });

  test("no string says atrasad…, riesgo, fallaste, deuda, ⚠️ or racha perdida", () => {
    expect(offenders(allStrings())).toEqual([]);
  });

  test("positive control: the scan does flag a forbidden word", () => {
    const planted: [string, string][] = [
      ["a", "Quedaron tareas atrasadas"],
      ["b", "Estás en riesgo"],
      ["c", "⚠️ Cuidado"],
      ["d", "Perdiste tu racha perdida"],
      ["e", "Esta es tu DEUDA"],
      ["f", "Fallaste otra vez"],
    ];
    expect(offenders(planted).map(([key]) => key)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(offenders([["ok", "Quedaron abiertas 4 tareas."]])).toEqual([]);
  });
});
