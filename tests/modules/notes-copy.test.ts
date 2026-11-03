// N1 of `notes`: the copy has no guilt (SPEC-notes "Tono"). Scans EVERY string exported by every
// `*copy.ts` file of the module (later cuts add theirs: the glob picks them up) and what their
// functions return. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import { NOTES_COPY } from "@/modules/notes/copy";

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

const copyModules = import.meta.glob("../../src/modules/notes/*copy.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

/** Sample arguments: a title, numbers. */
const SAMPLES = ["Apuntes IAM", 3, 40];

function collect(value: unknown, path: string, into: [string, string][]) {
  if (typeof value === "string") into.push([path, value]);
  else if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    for (const first of [SAMPLES[0], SAMPLES[1], true, false]) {
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

describe("notes copy has no guilt", () => {
  test("it finds the copy file and scans its strings", () => {
    expect(Object.keys(copyModules).some((file) => file.endsWith("/copy.ts"))).toBe(true);
    const scanned = allStrings().map(([, text]) => text);
    expect(scanned.length).toBeGreaterThan(80);
    for (const expected of [
      NOTES_COPY.todayNote,
      NOTES_COPY.continueTodayNote,
      NOTES_COPY.conflictTitle,
      NOTES_COPY.unsaved("Apuntes IAM"),
      "Seguir la nota de hoy",
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  test("no string says «atrasado», «fallaste», «deuda» or the like", () => {
    expect(offenders(allStrings())).toEqual([]);
  });

  test("positive control: the scan finds a forbidden word when there is one", () => {
    expect(offenders([["sample", "Vas atrasado con tu diario"]])).toHaveLength(1);
  });
});
