// L1 of `learning`: the pasted syllabus (one step per line), the next step and the counts
// (SPEC-learning "Supuestos" 2, "Estrategia de pruebas").
import { describe, expect, test } from "vitest";
import {
  nextStep,
  parseSyllabus,
  stepCounts,
  SYLLABUS_MAX_LENGTH,
} from "@/modules/learning/syllabus";

describe("parseSyllabus", () => {
  test("one step per line, in order; blank lines and surrounding spaces are left out", () => {
    expect(parseSyllabus("Clase 1: Intro\n\n   \n  Clase 2:   IAM \r\nClase 3\rClase 4\n")).toEqual(
      {
        ok: true,
        titles: ["Clase 1: Intro", "Clase 2: IAM", "Clase 3", "Clase 4"],
      },
    );
  });

  test("40 lines make 40 steps in order", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Clase ${i + 1}`).join("\n");
    const result = parseSyllabus(text);
    expect(result.ok && result.titles).toHaveLength(40);
    expect(result.ok && result.titles[39]).toBe("Clase 40");
  });

  test("an empty text is no steps (not an error)", () => {
    expect(parseSyllabus("")).toEqual({ ok: true, titles: [] });
    expect(parseSyllabus("\n \n\t\n")).toEqual({ ok: true, titles: [] });
  });

  test("500 steps fit; 501 are refused (blank lines don't count)", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Paso ${i}`).join("\n\n");
    expect(parseSyllabus(lines(500))).toMatchObject({ ok: true });
    expect(parseSyllabus(lines(501))).toEqual({ ok: false, error: "tooMany" });
  });

  test("a line of 200 characters fits; 201 refuses the paste and names the line", () => {
    expect(parseSyllabus("x".repeat(200))).toEqual({ ok: true, titles: ["x".repeat(200)] });
    expect(parseSyllabus(`Uno\n\n${"x".repeat(201)}`)).toEqual({
      ok: false,
      error: "tooLong",
      line: 3,
    });
    // Characters, not UTF-16 units: 200 emoji are 200 characters.
    expect(parseSyllabus("😀".repeat(200))).toMatchObject({ ok: true });
  });

  test("NUL or another control character refuses it, naming the line (never cut)", () => {
    expect(parseSyllabus("Uno\nDos\u0000\nTres")).toEqual({
      ok: false,
      error: "invisible",
      line: 2,
    });
    expect(parseSyllabus("Uno\n\u200BDos")).toEqual({ ok: false, error: "invisible", line: 2 });
  });

  test("a text longer than any syllabus is refused before splitting it", () => {
    expect(parseSyllabus("x".repeat(SYLLABUS_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "tooBig",
    });
  });
});

describe("the next step and the counts", () => {
  const step = (id: string, done: boolean) => ({
    id,
    doneAt: done ? "2026-11-02T15:00:00.000Z" : null,
  });

  test("the next step is the first one not done, even after a done one further down", () => {
    expect(nextStep([step("a", true), step("b", false), step("c", true)])?.id).toBe("b");
    expect(nextStep([step("a", false), step("b", true)])?.id).toBe("a");
  });

  test("none when every step is done or there is no syllabus", () => {
    expect(nextStep([step("a", true)])).toBeNull();
    expect(nextStep([])).toBeNull();
  });

  test("done of all", () => {
    expect(stepCounts([step("a", true), step("b", false), step("c", true)])).toEqual({
      done: 2,
      total: 3,
    });
    expect(stepCounts([])).toEqual({ done: 0, total: 0 });
  });
});
