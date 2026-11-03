// N1 of `notes`: the pure rules. The body's sanitation (the one projects' notes use, with 50 000),
// the title, the inputs of each action, valid and future days, the URL key, the long date, the
// excerpt and the list's URL parameters.
import { describe, expect, test } from "vitest";
import { markdownTextSchema } from "@/lib/markdown-text";
import { NOTES_ERRORS } from "@/modules/notes/copy";
import { NOTE_BODY_MAX_LENGTH, NOTES_MAX_SHOWN } from "@/modules/notes/note-constants";
import {
  addDays,
  dailyTitle,
  daysBetween,
  isDayKey,
  isWritableDay,
  parseNoteKey,
} from "@/modules/notes/note-day";
import {
  createNoteInputSchema,
  noteBodySchema,
  noteTitleSchema,
  saveDailyNoteInputSchema,
  saveNoteInputSchema,
} from "@/modules/notes/note-input";
import {
  editedLabel,
  kindFromParam,
  notesListUrl,
  shownFromParam,
} from "@/modules/notes/note-list";
import { excerptOf } from "@/modules/notes/note-text";
import {
  PROJECT_NOTES_ERRORS,
  updateProjectNotesInputSchema,
} from "@/modules/projects/project-notes-input";

const ID = "00000000-0000-4000-8000-000000000001";
const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => issue.message);

describe("the body", () => {
  test("is stored normalized: NFC, \\n, no leading blank lines, no trailing spaces", () => {
    expect(noteBodySchema.parse("\n\n  \nHola\r\nmundo\rfin  \n\n")).toBe("Hola\nmundo\nfin");
    expect(noteBodySchema.parse("    código")).toBe("    código");
    expect(noteBodySchema.parse("é")).toBe("é");
    expect(noteBodySchema.parse(null)).toBe("");
  });

  test("takes up to 50 000 characters (after normalizing), not one more", () => {
    expect(noteBodySchema.safeParse("x".repeat(NOTE_BODY_MAX_LENGTH)).success).toBe(true);
    // Trailing spaces don't count: they are trimmed first.
    expect(noteBodySchema.safeParse(`${"x".repeat(NOTE_BODY_MAX_LENGTH)}   `).success).toBe(true);
    expect(messages(noteBodySchema.safeParse("x".repeat(NOTE_BODY_MAX_LENGTH + 1)))).toEqual([
      NOTES_ERRORS.body.tooLong,
    ]);
  });

  test.each([
    ["NUL", "a\u0000b"],
    ["escape", "a\u001bb"],
    ["backspace", "a\u0008b"],
  ])("refuses control characters (%s); tabs and line breaks stay", (_, value) => {
    expect(messages(noteBodySchema.safeParse(value))).toEqual([NOTES_ERRORS.body.control]);
    expect(noteBodySchema.parse("a\tb\nc")).toBe("a\tb\nc");
  });

  test.each(["‮", "⁦", "‪", "⁩"])("refuses the bidi control %j", (bidi) => {
    expect(messages(noteBodySchema.safeParse(`hola${bidi}mundo`))).toEqual([
      NOTES_ERRORS.body.bidi,
    ]);
    // The plain marks stay.
    expect(noteBodySchema.safeParse("hola‏mundo").success).toBe(true);
  });

  test("the shared schema keeps the projects' limit and messages (20 000, null clears)", () => {
    const projects = updateProjectNotesInputSchema;
    expect(projects.parse({ id: ID, notes: "  " }).notes).toBeNull();
    expect(projects.safeParse({ id: ID, notes: "x".repeat(20_001) }).success).toBe(false);
    // A missing value is refused, never read as «clear the notes».
    expect(projects.safeParse({ id: ID }).success).toBe(false);
    const schema = markdownTextSchema(5, PROJECT_NOTES_ERRORS);
    expect(messages(schema.safeParse("123456"))).toEqual([PROJECT_NOTES_ERRORS.tooLong]);
  });
});

describe("the title", () => {
  test("is normalized like names and takes 1–120 characters", () => {
    expect(noteTitleSchema.parse("  Apuntes \n IAM ")).toBe("Apuntes IAM");
    expect(noteTitleSchema.safeParse("x".repeat(120)).success).toBe(true);
    expect(messages(noteTitleSchema.safeParse("x".repeat(121)))).toEqual([
      NOTES_ERRORS.titleTooLong,
    ]);
    expect(messages(noteTitleSchema.safeParse("   "))).toEqual([NOTES_ERRORS.titleRequired]);
  });

  test("refuses invisible characters", () => {
    expect(messages(noteTitleSchema.safeParse("Apu​ntes"))).toEqual([NOTES_ERRORS.invisible]);
    expect(messages(noteTitleSchema.safeParse("Apu\u0000ntes"))).toEqual([NOTES_ERRORS.invisible]);
  });
});

describe("the actions' inputs", () => {
  test("a save needs a uuid, the body and a whole version from 1", () => {
    expect(saveNoteInputSchema.parse({ id: ID, body: "Hola ", version: 3 })).toEqual({
      id: ID,
      body: "Hola",
      version: 3,
    });
    expect(saveNoteInputSchema.safeParse({ id: ID, body: "x", version: 0 }).success).toBe(false);
    expect(saveNoteInputSchema.safeParse({ id: ID, body: "x", version: 1.5 }).success).toBe(false);
    expect(saveNoteInputSchema.safeParse({ id: "x", body: "x", version: 1 }).success).toBe(false);
    expect(saveNoteInputSchema.safeParse({ id: ID, version: 1 }).success).toBe(false);
  });

  test("a day's first save needs a real day", () => {
    expect(saveDailyNoteInputSchema.safeParse({ day: "2026-11-03", body: "x" }).success).toBe(true);
    for (const day of ["2026-02-30", "2026-11-3", "03/11/2026", "", 20261103]) {
      expect(saveDailyNoteInputSchema.safeParse({ day, body: "x" }).success).toBe(false);
    }
  });

  test("a new note takes a title and an area or none", () => {
    expect(createNoteInputSchema.parse({ title: " Apuntes ", areaId: null })).toEqual({
      title: "Apuntes",
      areaId: null,
    });
    expect(createNoteInputSchema.safeParse({ title: "A", areaId: "nope" }).success).toBe(false);
    expect(createNoteInputSchema.safeParse({ title: "A" }).success).toBe(false);
  });
});

describe("days", () => {
  test("a day is a real calendar day written YYYY-MM-DD", () => {
    expect(isDayKey("2026-11-03")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-1-01")).toBe(false);
  });

  test("today and the past may be written; the future and before 2000 may not", () => {
    expect(isWritableDay("2026-11-03", "2026-11-03")).toBe(true);
    expect(isWritableDay("2026-11-02", "2026-11-03")).toBe(true);
    expect(isWritableDay("2026-11-04", "2026-11-03")).toBe(false);
    expect(isWritableDay("1999-12-31", "2026-11-03")).toBe(false);
  });

  test("the URL key: a writable day, a uuid, or nothing (404)", () => {
    expect(parseNoteKey("2026-11-03", "2026-11-03")).toEqual({ kind: "daily", day: "2026-11-03" });
    expect(parseNoteKey("2026-11-04", "2026-11-03")).toBeNull();
    expect(parseNoteKey("2026-02-30", "2026-11-03")).toBeNull();
    expect(parseNoteKey(ID.toUpperCase(), "2026-11-03")).toEqual({ kind: "page", id: ID });
    expect(parseNoteKey("hoy", "2026-11-03")).toBeNull();
    expect(parseNoteKey("../2026-11-03", "2026-11-03")).toBeNull();
  });

  test("moving days crosses months and years", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-31", "2026-11-03")).toBe(3);
  });

  test("the long date, with the year only when it isn't this year's", () => {
    expect(dailyTitle("2026-11-03", "2026-11-03")).toBe("Martes 3 de noviembre");
    expect(dailyTitle("2025-10-31", "2026-11-03")).toBe("Viernes 31 de octubre de 2025");
  });
});

describe("the list", () => {
  test("the excerpt is the first line with text, plain and short", () => {
    expect(excerptOf("\n\n# Apuntes **IAM**\nresto")).toBe("Apuntes IAM");
    expect(excerptOf("- [ ] Llamar al banco")).toBe("Llamar al banco");
    expect(excerptOf("> cita `código`")).toBe("cita código");
    expect(excerptOf("---\n\n1. Primero")).toBe("Primero");
    expect(excerptOf("")).toBe("");
    const long = excerptOf("palabra ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("…")).toBe(true);
  });

  test("the URL parameters: kind, area and how many", () => {
    expect(kindFromParam("diario")).toBe("daily");
    expect(kindFromParam("notas")).toBe("page");
    expect(kindFromParam("otra")).toBe("all");
    expect(kindFromParam(null)).toBe("all");
    expect(shownFromParam(null)).toBe(30);
    expect(shownFromParam("60")).toBe(60);
    expect(shownFromParam("45")).toBe(60);
    expect(shownFromParam("-1")).toBe(30);
    expect(shownFromParam("1e9")).toBe(NOTES_MAX_SHOWN);
    expect(notesListUrl({ kind: "all", areaId: null })).toBe("/notes");
    expect(notesListUrl({ kind: "daily", areaId: ID, shown: 60 })).toBe(
      `/notes?tipo=diario&area=${ID}&n=60`,
    );
  });

  test("when a row was edited", () => {
    expect(editedLabel("2026-11-03", "2026-11-03")).toBe("Hoy");
    expect(editedLabel("2026-11-02", "2026-11-03")).toBe("Ayer");
    expect(editedLabel("2026-10-30", "2026-11-03")).toBe("Hace 4 días");
    expect(editedLabel("2026-10-03", "2026-11-03")).toBe("3 oct. 2026");
  });
});
