// N3 of `notes`: the pure side of «Convertir en tarea» and the quick capture (note-lines.ts and
// src/lib/markdown/task-items.ts). Task items are numbered as the renderer sees them (nested, in
// quotes, CRLF, done ones), never inside code; an item with a link or a lazy continuation can't
// become a task; converting and its «Deshacer» touch only that line; the capture's line carries
// Lima's clock (around midnight too), lands after a line break and its «Deshacer» removes exactly
// it; «Ese día»'s line; the inputs of the new actions.
import { describe, expect, test } from "vitest";
import { dayFooterText, NOTES_COPY as COPY, NOTES_ERRORS } from "@/modules/notes/copy";
import {
  captureNoteInputSchema,
  convertLineInputSchema,
  noteBodySchema,
  undoCaptureInputSchema,
  undoConvertLineInputSchema,
} from "@/modules/notes/note-input";
import {
  appendLine,
  captureLine,
  convertTaskItem,
  findConvertibleItem,
  limaClock,
  lineAt,
  listTaskItems,
  removeAppended,
  restoreTaskItem,
} from "@/modules/notes/note-lines";

const TASK = "0d6f3a8e-1c2b-4d5e-8f90-123456789abc";
const OTHER = "11111111-2222-4333-8444-555555555555";

const summary = (body: string) =>
  listTaskItems(body).map(({ index, checked, line, text }) => ({ index, checked, line, text }));

describe("task items, numbered as the renderer sees them", () => {
  test("open and done items, any marker and depth, in document order", () => {
    const body = [
      "Hoy:",
      "- [ ] Llamar al banco",
      "- [x] Pagar la luz",
      "  - [ ] Revisar el recibo",
      "* [ ]  Comprar pan  ",
      "1. [ ] Primero",
      "2) [X] Segundo",
    ].join("\n");
    expect(summary(body)).toEqual([
      { index: 0, checked: false, line: 1, text: "Llamar al banco" },
      { index: 1, checked: true, line: 2, text: null },
      { index: 2, checked: false, line: 3, text: "Revisar el recibo" },
      { index: 3, checked: false, line: 4, text: "Comprar pan" },
      { index: 4, checked: false, line: 5, text: "Primero" },
      { index: 5, checked: true, line: 6, text: null },
    ]);
  });

  test("items inside code never count (fenced, indented or inline)", () => {
    const body = [
      "```",
      "- [ ] dentro de código",
      "```",
      "",
      "    - [ ] indentado es código",
      "",
      "`- [ ] en línea`",
      "",
      "- [ ] la de verdad",
    ].join("\n");
    expect(summary(body)).toEqual([{ index: 0, checked: false, line: 8, text: "la de verdad" }]);
  });

  test("CRLF line breaks: same items, same lines", () => {
    const body = "Lista\r\n- [ ] Uno\r\n- [ ] Dos";
    expect(summary(body)).toEqual([
      { index: 0, checked: false, line: 1, text: "Uno" },
      { index: 1, checked: false, line: 2, text: "Dos" },
    ]);
  });

  test("a link inside, a lazy continuation or no text: counted, but not convertible", () => {
    const body = [
      `- [ ] Llamar a [[project:${OTHER}|Banco]]`,
      "- [ ] Una línea",
      "que sigue",
      // An empty box with no text isn't a GFM task item at all (no index).
      "- [ ]",
      "- [ ] Bien",
    ].join("\n");
    expect(summary(body).map(({ index, text }) => [index, text])).toEqual([
      [0, null],
      [1, null],
      [2, "Bien"],
    ]);
  });

  test("a task link item is not a GFM task item (no index); quotes do count", () => {
    const body = [`- [[task:${TASK}|Ya es tarea]]`, "> - [ ] En una cita"].join("\n");
    expect(summary(body)).toEqual([{ index: 0, checked: false, line: 1, text: "En una cita" }]);
  });

  test("a text holding the placeholder characters has nothing convertible", () => {
    expect(summary("- [ ] Uno \uE010x\n- [ ] Dos")).toEqual([
      { index: 0, checked: false, line: 0, text: null },
      { index: 1, checked: false, line: 1, text: null },
    ]);
  });

  test("findConvertibleItem needs the index and the exact text", () => {
    const body = "- [ ] Uno\n- [ ] Dos";
    expect(findConvertibleItem(body, 1, "Dos")?.line).toBe(1);
    expect(findConvertibleItem(body, 1, "Uno")).toBeNull();
    expect(findConvertibleItem(body, 2, "Dos")).toBeNull();
  });
});

describe("converting a line and its «Deshacer»", () => {
  test("only that line changes; its prefix (indent, quote, marker) stays", () => {
    // (A blank line before «Después»: right after an item it would be a lazy continuation.)
    const body = "Antes\n  - [ ] Revisar el recibo\n> * [ ]\tEn una cita\n\nDespués";
    const [nested, quoted] = listTaskItems(body);
    const converted = convertTaskItem(body, nested, TASK);
    expect(converted).toBe(
      `Antes\n  - [[task:${TASK}|Revisar el recibo]]\n> * [ ]\tEn una cita\n\nDespués`,
    );
    const both = convertTaskItem(converted!, listTaskItems(converted!)[0], OTHER);
    expect(both).toBe(
      `Antes\n  - [[task:${TASK}|Revisar el recibo]]\n> * [[task:${OTHER}|En una cita]]\n\nDespués`,
    );
    expect(quoted.text).toBe("En una cita");
  });

  test("the link's name drops [, ] and |; the line break (CRLF) is kept", () => {
    const body = "- [ ] Ver a|b [x]\r\n- [ ] Otra";
    const [item] = listTaskItems(body);
    expect(convertTaskItem(body, item, TASK)).toBe(`- [[task:${TASK}|Ver a b x]]\r\n- [ ] Otra`);
  });

  test("«Deshacer» puts the original line back, only where the link is", () => {
    const body = "Antes\n  - [ ]  Revisar  \n\nDespués";
    const [item] = listTaskItems(body);
    const converted = convertTaskItem(body, item, TASK)!;
    const original = lineAt(body, item.line)!;
    expect(restoreTaskItem(converted, item.line, TASK, original)).toBe(body);
    // Another task's id, another line, or an "original" with another prefix: nothing.
    expect(restoreTaskItem(converted, item.line, OTHER, original)).toBeNull();
    expect(restoreTaskItem(converted, 0, TASK, original)).toBeNull();
    expect(restoreTaskItem(converted, item.line, TASK, "- [ ] Revisar")).toBeNull();
    expect(restoreTaskItem(converted, item.line, TASK, "  - Revisar")).toBeNull();
  });
});

describe("the capture's line", () => {
  test("Lima's clock, 24 hours, around midnight", () => {
    // Lima is UTC−5 all year.
    expect(limaClock(new Date("2026-11-04T04:59:00Z"))).toBe("23:59");
    expect(limaClock(new Date("2026-11-04T05:00:00Z"))).toBe("00:00");
    expect(limaClock(new Date("2026-11-03T23:42:30Z"))).toBe("18:42");
    expect(captureLine(new Date("2026-11-03T23:42:00Z"), "idea: comparar Neon con Supabase")).toBe(
      "- 18:42 idea: comparar Neon con Supabase",
    );
  });

  test("appended after a line break when the note has text; «Deshacer» removes exactly it", () => {
    expect(appendLine("", "- 08:00 a")).toEqual({ body: "- 08:00 a", appended: "- 08:00 a" });
    expect(appendLine("Hola", "- 08:00 a")).toEqual({
      body: "Hola\n- 08:00 a",
      appended: "\n- 08:00 a",
    });
    expect(appendLine("Hola\n", "- 08:00 a")).toEqual({
      body: "Hola\n- 08:00 a",
      appended: "- 08:00 a",
    });
    expect(removeAppended("Hola\n- 08:00 a", "\n- 08:00 a")).toBe("Hola");
    expect(removeAppended("- 08:00 a", "- 08:00 a")).toBe("");
    expect(removeAppended("Hola\n- 08:00 a\nmás", "\n- 08:00 a")).toBeNull();
    expect(removeAppended("Hola", "")).toBeNull();
  });
});

describe("«Ese día»", () => {
  test("singular and plural, a part at 0 left out, both at 0 neutral", () => {
    expect(dayFooterText(4, 3)).toBe("4 tareas hechas · 3 hábitos cumplidos");
    expect(dayFooterText(1, 1)).toBe("1 tarea hecha · 1 hábito cumplido");
    expect(dayFooterText(0, 2)).toBe("2 hábitos cumplidos");
    expect(dayFooterText(5, 0)).toBe("5 tareas hechas");
    expect(dayFooterText(0, 0)).toBe(COPY.dayFooterEmpty);
  });
});

describe("the inputs of the N3 actions", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  test("capture: one line, 1–500, whitespace collapsed, no control characters", () => {
    expect(captureNoteInputSchema.parse({ text: "  idea:\ncomparar\t Neon " })).toEqual({
      text: "idea: comparar Neon",
    });
    const refusal = (text: string) =>
      captureNoteInputSchema.safeParse({ text }).error?.issues[0]?.message;
    expect(refusal("   ")).toBe(NOTES_ERRORS.captureEmpty);
    expect(refusal("a".repeat(501))).toBe(NOTES_ERRORS.captureTooLong);
    expect(captureNoteInputSchema.safeParse({ text: "a".repeat(500) }).success).toBe(true);
    expect(refusal("con\u0000nul")).toBe(NOTES_ERRORS.captureInvisible);
    expect(refusal("bidi \u202E")).toBe(NOTES_ERRORS.captureInvisible);
  });

  test("undo of a capture: only a line it could have appended", () => {
    const ok = (appended: string) =>
      undoCaptureInputSchema.safeParse({ noteId: id, day: "2026-11-03", version: 2, appended })
        .success;
    expect(ok("- 18:42 idea")).toBe(true);
    expect(ok("\n- 18:42 idea")).toBe(true);
    expect(ok("Hola")).toBe(false);
    expect(ok("\n- 18:42 idea\notra")).toBe(false);
    expect(ok("\n\n- 18:42 idea")).toBe(false);
  });

  test("convert and its undo: uuid, version, a bounded index, one line of text", () => {
    expect(
      convertLineInputSchema.safeParse({ noteId: id, version: 1, index: 0, text: "Uno" }).success,
    ).toBe(true);
    for (const bad of [
      { noteId: "x", version: 1, index: 0, text: "Uno" },
      { noteId: id, version: 0, index: 0, text: "Uno" },
      { noteId: id, version: 1, index: -1, text: "Uno" },
      { noteId: id, version: 1, index: 0, text: "Uno\nDos" },
      { noteId: id, version: 1, index: 0, text: "  " },
      { noteId: id, version: 1, index: 0, text: "a\u0000b" },
    ]) {
      expect(convertLineInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(
      undoConvertLineInputSchema.safeParse({
        noteId: id,
        version: 2,
        taskId: TASK,
        line: 3,
        original: "- [ ] Uno",
      }).success,
    ).toBe(true);
    expect(
      undoConvertLineInputSchema.safeParse({
        noteId: id,
        version: 2,
        taskId: TASK,
        line: 3,
        original: "- [ ] Uno\r",
      }).success,
    ).toBe(false);
  });
});

describe("review fixes (N3)", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  test("an item's plain text: no Markdown marks, a link's text without its URL", () => {
    const [item] = listTaskItems("- [ ] Llamar **al** [banco](https://banco.example) `ya`");
    expect(item.text).toBe("Llamar **al** [banco](https://banco.example) `ya`");
    expect(item.plain).toBe("Llamar al banco ya");
    // The link's name is the plain text; the line keeps everything before the box.
    expect(
      convertTaskItem(
        "- [ ] Llamar **al** banco",
        listTaskItems("- [ ] Llamar **al** banco")[0],
        TASK,
      ),
    ).toBe(`- [[task:${TASK}|Llamar al banco]]`);
  });

  test("the undo of a capture names the day it returned", () => {
    expect(
      undoCaptureInputSchema.safeParse({ noteId: id, version: 2, appended: "- 18:42 idea" })
        .success,
    ).toBe(false);
    expect(
      undoCaptureInputSchema.safeParse({
        noteId: id,
        day: "2026-11-31",
        version: 2,
        appended: "- 18:42 idea",
      }).success,
    ).toBe(false);
  });

  test("a line sent in NFD is compared in NFC (as stored)", () => {
    const decomposed = "Cafe\u0301";
    const parsed = convertLineInputSchema.parse({
      noteId: id,
      version: 1,
      index: 0,
      text: decomposed,
    });
    expect(parsed.text).toBe("Café");
  });

  test("bidi controls and the placeholders' characters are refused in a line, a capture and a body", () => {
    const line = (text: string) =>
      undoConvertLineInputSchema.safeParse({
        noteId: id,
        version: 2,
        taskId: TASK,
        line: 0,
        original: text,
      }).success;
    expect(line("- [ ] Uno")).toBe(true);
    expect(line("- [ ] Uno \u202E")).toBe(false);
    expect(line("- [ ] Uno \uE010")).toBe(false);
    expect(captureNoteInputSchema.safeParse({ text: "idea \uE011" }).success).toBe(false);
    expect(noteBodySchema.safeParse("Hola \uE010x\uE011").error?.issues[0]?.message).toBe(
      NOTES_ERRORS.body.placeholder,
    );
    expect(noteBodySchema.safeParse("Hola").success).toBe(true);
  });
});
