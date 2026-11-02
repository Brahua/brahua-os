// L1 of `learning`: the Zod schemas of tracks and steps (what the sheet and the actions accept)
// and the course's link. The table's CHECKs accept the same texts (tests/integration).
import { describe, expect, test } from "vitest";
import {
  addStepInputSchema,
  pasteStepsInputSchema,
  reorderStepsInputSchema,
  undoStepDoneInputSchema,
} from "@/modules/learning/steps-input";
import { acceptableTrackUrl, trackDomain } from "@/modules/learning/track-url";
import {
  changeStatusInputSchema,
  createTrackInputSchema,
  undoStatusInputSchema,
  updateTrackInputSchema,
} from "@/modules/learning/tracks-input";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const errorsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => String(issue.path[0]));

describe("create", () => {
  test("a name and a kind are enough: the rest is none, in progress, no syllabus", () => {
    expect(createTrackInputSchema.parse({ title: "  AWS   SAA ", kind: "certification" })).toEqual({
      title: "AWS SAA",
      kind: "certification",
      projectId: null,
      url: null,
      weeklyTargetMinutes: null,
      targetDate: null,
      syllabus: [],
      status: "active",
      pauseTrackId: null,
    });
  });

  test("the pasted syllabus becomes its steps; empty fields are none", () => {
    const parsed = createTrackInputSchema.parse({
      title: "Curso",
      kind: "course",
      syllabus: "Clase 1\n\nClase 2\n",
      projectId: "",
      url: " ",
      targetDate: "",
      status: "waiting",
      pauseTrackId: "",
    });
    expect(parsed).toMatchObject({
      syllabus: ["Clase 1", "Clase 2"],
      projectId: null,
      url: null,
      targetDate: null,
      status: "waiting",
      pauseTrackId: null,
    });
  });

  test("a practice can't bring a syllabus", () => {
    const result = createTrackInputSchema.safeParse({
      title: "Inglés",
      kind: "practice",
      syllabus: "Unidad 1",
    });
    expect(errorsOf(result)).toEqual(["syllabus"]);
    expect(createTrackInputSchema.safeParse({ title: "Inglés", kind: "practice" }).success).toBe(
      true,
    );
  });

  test("a bad syllabus says why, on its field", () => {
    const result = createTrackInputSchema.safeParse({
      title: "Curso",
      kind: "course",
      syllabus: `Uno\n${"x".repeat(201)}`,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["syllabus"],
      message: "La línea 2 pasa de 200 caracteres. Acórtala o pártela en dos.",
    });
  });

  test("bounds: name 1–120, weekly target 15–3000, a real date in 2000–2100, known kind", () => {
    const base = { title: "Libro", kind: "book" };
    for (const [patch, field] of [
      [{ title: "" }, "title"],
      [{ title: "x".repeat(121) }, "title"],
      [{ title: "Hola\u0000" }, "title"],
      [{ kind: "podcast" }, "kind"],
      [{ weeklyTargetMinutes: 14 }, "weeklyTargetMinutes"],
      [{ weeklyTargetMinutes: 3001 }, "weeklyTargetMinutes"],
      [{ weeklyTargetMinutes: 30.5 }, "weeklyTargetMinutes"],
      [{ weeklyTargetMinutes: Number.NaN }, "weeklyTargetMinutes"],
      [{ targetDate: "2026-02-30" }, "targetDate"],
      [{ targetDate: "1999-12-31" }, "targetDate"],
      [{ targetDate: "2101-01-01" }, "targetDate"],
      [{ url: "ftp://x.com" }, "url"],
      [{ url: "https://user:pass@x.com" }, "url"],
      [{ projectId: "nope" }, "projectId"],
      [{ status: "done" }, "status"],
    ] as const) {
      expect(errorsOf(createTrackInputSchema.safeParse({ ...base, ...patch }))).toEqual([field]);
    }
    expect(
      createTrackInputSchema.safeParse({
        ...base,
        title: "x".repeat(120),
        weeklyTargetMinutes: 15,
        targetDate: "2100-12-31",
      }).success,
    ).toBe(true);
    expect(createTrackInputSchema.safeParse({ ...base, weeklyTargetMinutes: 3000 }).success).toBe(
      true,
    );
  });

  test("the one to pause only goes with «En curso»", () => {
    expect(
      errorsOf(
        createTrackInputSchema.safeParse({
          title: "A",
          kind: "book",
          status: "waiting",
          pauseTrackId: ID,
        }),
      ),
    ).toEqual(["pauseTrackId"]);
    expect(
      createTrackInputSchema.safeParse({
        title: "A",
        kind: "book",
        status: "active",
        pauseTrackId: ID,
      }).success,
    ).toBe(true);
  });
});

describe("settings, status and its undo", () => {
  test("settings send every field whole (a missing optional one is none)", () => {
    expect(updateTrackInputSchema.parse({ id: ID, title: "A", kind: "course" })).toMatchObject({
      projectId: null,
      url: null,
      weeklyTargetMinutes: null,
      targetDate: null,
    });
  });

  test("a status change; pausing another only when putting this one in progress", () => {
    expect(changeStatusInputSchema.parse({ id: ID, to: "done" })).toEqual({
      id: ID,
      to: "done",
      pauseTrackId: null,
    });
    expect(
      changeStatusInputSchema.safeParse({ id: ID, to: "active", pauseTrackId: OTHER }).success,
    ).toBe(true);
    expect(
      changeStatusInputSchema.safeParse({ id: ID, to: "waiting", pauseTrackId: OTHER }).success,
    ).toBe(false);
    expect(
      changeStatusInputSchema.safeParse({ id: ID, to: "active", pauseTrackId: ID }).success,
    ).toBe(false);
    expect(changeStatusInputSchema.safeParse({ id: ID, to: "lost" }).success).toBe(false);
  });

  test("the undo carries one or two changes, each consistent with the table's rule", () => {
    const change = (patch: object = {}) => ({
      id: ID,
      from: { status: "active", position: 0, finishedAt: null },
      to: "waiting",
      ...patch,
    });
    expect(undoStatusInputSchema.safeParse({ changes: [change()] }).success).toBe(true);
    expect(undoStatusInputSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(undoStatusInputSchema.safeParse({ changes: [change(), change()] }).success).toBe(false);
    expect(
      undoStatusInputSchema.safeParse({
        changes: [change({ from: { status: "done", position: 0, finishedAt: null } })],
      }).success,
    ).toBe(false);
    expect(
      undoStatusInputSchema.safeParse({
        changes: [
          change({ from: { status: "done", position: 1, finishedAt: "2026-11-02T15:00:00.123Z" } }),
        ],
      }).success,
    ).toBe(true);
  });
});

describe("steps", () => {
  test("a step's title is normalized, 1–200 characters, without control characters", () => {
    expect(addStepInputSchema.parse({ trackId: ID, id: OTHER, title: "  Clase   1 " }).title).toBe(
      "Clase 1",
    );
    for (const title of ["", "   ", "x".repeat(201), "a\u0000b"]) {
      expect(addStepInputSchema.safeParse({ trackId: ID, id: OTHER, title }).success).toBe(false);
    }
  });

  test("a paste needs at least one line with text", () => {
    expect(pasteStepsInputSchema.safeParse({ trackId: ID, syllabus: "\n \n" }).success).toBe(false);
    expect(pasteStepsInputSchema.parse({ trackId: ID, syllabus: "A\nB" }).syllabus).toEqual([
      "A",
      "B",
    ]);
  });

  test("a reorder is a set of ids: no repeats, at most 500", () => {
    expect(reorderStepsInputSchema.safeParse({ trackId: ID, ids: [ID, ID] }).success).toBe(false);
    expect(reorderStepsInputSchema.safeParse({ trackId: ID, ids: [] }).success).toBe(false);
    expect(reorderStepsInputSchema.safeParse({ trackId: ID, ids: [ID, OTHER] }).success).toBe(true);
  });

  test("a check's undo carries instants or nothing", () => {
    expect(
      undoStepDoneInputSchema.safeParse({
        trackId: ID,
        id: OTHER,
        expected: "2026-11-02T15:00:00.123Z",
        restore: null,
      }).success,
    ).toBe(true);
    expect(
      undoStepDoneInputSchema.safeParse({ trackId: ID, id: OTHER, expected: "ayer", restore: null })
        .success,
    ).toBe(false);
  });
});

describe("the course's link", () => {
  test("http(s) only, without spaces or credentials; the scheme is stored in lowercase", () => {
    expect(acceptableTrackUrl(" HTTPS://platzi.com/cursos/aws ")).toBe(
      "https://platzi.com/cursos/aws",
    );
    expect(acceptableTrackUrl("javascript:alert(1)")).toBeNull();
    expect(acceptableTrackUrl("https://a b.com")).toBeNull();
    expect(acceptableTrackUrl("https://x.com@evil.example")).toBeNull();
    expect(acceptableTrackUrl(`https://x.com/${"a".repeat(2000)}`)).toBeNull();
    expect(trackDomain("https://www.udemy.com/course/x")).toBe("udemy.com");
  });
});
