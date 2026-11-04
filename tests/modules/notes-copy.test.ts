// N1 of `notes`: the copy has no guilt (SPEC-notes "Tono"). Scans EVERY string exported by every
// `*copy.ts` file of the module (later cuts add theirs: the glob picks them up) and what their
// functions return. A positive control proves the scan can fail.
import { describe, expect, test } from "vitest";
import { dayFooterText, NOTES_COPY, NOTES_ERRORS } from "@/modules/notes/copy";

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
      // N3: the line → task, the capture and «Ese día».
      NOTES_COPY.convert,
      NOTES_COPY.captured("Apuntes IAM"),
      NOTES_COPY.dayFooterEmpty,
      NOTES_ERRORS.changed,
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  test("N3: «Ese día» never counts what was missing, whatever the numbers", () => {
    const lines = [0, 1, 2, 7].flatMap((tasks) =>
      [0, 1, 3].map((habits) => dayFooterText(tasks, habits)),
    );
    expect(offenders(lines.map((line) => ["dayFooterText", line]))).toEqual([]);
    for (const line of lines) expect(line).not.toMatch(/falt|sin hacer|de \d|pendiente/i);
  });

  test("no string says «atrasado», «fallaste», «deuda» or the like", () => {
    expect(offenders(allStrings())).toEqual([]);
  });

  test("positive control: the scan finds a forbidden word when there is one", () => {
    expect(offenders([["sample", "Vas atrasado con tu diario"]])).toHaveLength(1);
  });
});
