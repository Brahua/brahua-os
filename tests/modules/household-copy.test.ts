// H1 of `household`: the copy has no guilt (SPEC-household "Tono", "Estrategia de pruebas"). Scans
// EVERY string exported by every `*-copy.ts` file of the module (H2 and H3 add theirs: the glob
// picks them up) and what their functions return. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";

const FORBIDDEN = [
  "atrasad",
  "riesgo",
  "fallaste",
  "deuda",
  "⚠️",
  "racha perdida",
  "pendiente de culpa",
];

const copyModules = import.meta.glob("../../src/modules/household/*-copy.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

const SAMPLES = ["Limpiar inodoro", 3, "lunes 12"];

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

describe("household copy has no guilt", () => {
  test("it finds the copy files and scans their strings", () => {
    expect(Object.keys(copyModules).some((file) => file.endsWith("cleaning-copy.ts"))).toBe(true);
    const scanned = allStrings().map(([, text]) => text);
    expect(scanned.length).toBeGreaterThan(30);
    for (const expected of [
      "De antes",
      "toca hoy",
      "Nada que limpiar por ahora.",
      "Hecho",
      "Añadir limpieza",
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  test("none of it says the forbidden words", () => {
    expect(offenders(allStrings())).toEqual([]);
  });

  test("positive control: the scan finds a forbidden word", () => {
    expect(
      offenders([
        ["x", "Tareas atrasadas"],
        ["y", "Al día"],
      ]),
    ).toEqual([["x", "Tareas atrasadas"]]);
  });
});
