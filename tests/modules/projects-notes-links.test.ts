// P5: schemas of notes and links, the URL rules, and the links' optimistic view.
import { describe, expect, test } from "vitest";
import {
  addProjectLinkInputSchema,
  linkHost,
  linkText,
  parseLinkUrl,
  PROJECT_LINK_ERRORS,
  removeProjectLinkInputSchema,
  reorderProjectLinksInputSchema,
  updateProjectLinkInputSchema,
} from "@/modules/projects/project-link-input";
import { applyLinksChange } from "@/modules/projects/project-links-optimistic";
import {
  normalizeNotes,
  PROJECT_NOTES_ERRORS,
  PROJECT_NOTES_MAX_LENGTH,
  updateProjectNotesInputSchema,
} from "@/modules/projects/project-notes-input";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";

const ID = "00000000-0000-4000-8000-000000000001";
const LINK = "00000000-0000-4000-8000-0000000000a1";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("notes", () => {
  const parse = (notes: unknown) => updateProjectNotesInputSchema.safeParse({ id: ID, notes });

  test("keeps Markdown as written: line breaks, tabs, indentation and symbols", () => {
    const text = "# Plan\n\n- [ ] Pintar\n\t- detalle\n\n    código\n\n| a | b |";
    expect(parse(text).data?.notes).toBe(text);
  });

  test("normalizes line endings and NFC; trims blank lines at the start and the end", () => {
    expect(normalizeNotes("\n\n  \nHola\r\nmundo\rfin  \n\n")).toBe("Hola\nmundo\nfin");
    // Leading spaces on the first line mean code: kept.
    expect(normalizeNotes("    const a = 1;")).toBe("    const a = 1;");
    expect(normalizeNotes("é")).toBe("é");
  });

  test("empty, blank or null clears them", () => {
    expect(parse("").data?.notes).toBeNull();
    expect(parse(" \n\t\n ").data?.notes).toBeNull();
    expect(parse(null).data?.notes).toBeNull();
  });

  test(`up to ${PROJECT_NOTES_MAX_LENGTH} characters (after normalizing)`, () => {
    expect(parse("a".repeat(PROJECT_NOTES_MAX_LENGTH)).success).toBe(true);
    expect(parse(`${"a".repeat(PROJECT_NOTES_MAX_LENGTH)}\n\n`).success).toBe(true);
    const tooLong = parse("a".repeat(PROJECT_NOTES_MAX_LENGTH + 1));
    expect(messages(tooLong)).toEqual([PROJECT_NOTES_ERRORS.tooLong]);
    expect(PROJECT_NOTES_ERRORS.tooLong).toBe("Usa 20.000 caracteres como máximo.");
  });

  test.each([
    ["NUL", "a\u0000b"],
    ["escape", "a\u001b[31mb"],
    ["backspace", "a\bb"],
    ["vertical tab", "a\vb"],
    ["form feed", "a\fb"],
    ["DEL", "a\u007fb"],
    ["C1 control", "a\u0085b"],
  ])("control characters are refused: %s", (_name, text) => {
    expect(messages(parse(text))).toEqual([PROJECT_NOTES_ERRORS.control]);
  });

  test("the id must be a uuid; the notes must be text", () => {
    expect(messages(updateProjectNotesInputSchema.safeParse({ id: "1", notes: "a" }))).toEqual([
      PROJECT_ERRORS.notFound,
    ]);
    expect(parse(42).success).toBe(false);
  });
});

describe("link URLs", () => {
  test.each([
    ["https://example.com", "https://example.com/"],
    ["http://example.com/a?b=c#d", "http://example.com/a?b=c#d"],
    ["HTTPS://Example.COM/Ruta", "https://example.com/Ruta"],
    ["  https://example.com/a b  ", "https://example.com/a%20b"],
    ["example.com/docs", "https://example.com/docs"],
    ["www.example.com", "https://www.example.com/"],
    ["https://münchen.de", "https://xn--mnchen-3ya.de/"],
  ])("%s is stored as %s", (input, stored) => {
    expect(parseLinkUrl(input)).toEqual({ ok: true, url: stored });
  });

  test.each([
    ["javascript:alert(1)", PROJECT_LINK_ERRORS.urlScheme],
    ["JavaScript:alert(1)", PROJECT_LINK_ERRORS.urlScheme],
    ["data:text/html,<script>alert(1)</script>", PROJECT_LINK_ERRORS.urlScheme],
    ["vbscript:msgbox(1)", PROJECT_LINK_ERRORS.urlScheme],
    ["ftp://example.com/file", PROJECT_LINK_ERRORS.urlScheme],
    ["mailto:yo@example.com", PROJECT_LINK_ERRORS.urlScheme],
    ["file:///etc/passwd", PROJECT_LINK_ERRORS.urlScheme],
    ["", PROJECT_LINK_ERRORS.urlRequired],
    ["   ", PROJECT_LINK_ERRORS.urlRequired],
    ["https://", PROJECT_LINK_ERRORS.urlInvalid],
    ["https://exa mple.com", PROJECT_LINK_ERRORS.urlInvalid],
    ["java\nscript:alert(1)", PROJECT_LINK_ERRORS.urlInvalid],
    ["https://example.com/\u0000", PROJECT_LINK_ERRORS.urlInvalid],
  ])("%j is refused", (input, error) => {
    expect(parseLinkUrl(input)).toEqual({ ok: false, error });
  });

  test("up to 2048 characters as stored", () => {
    const base = "https://example.com/";
    expect(parseLinkUrl(base + "a".repeat(2048 - base.length)).ok).toBe(true);
    expect(parseLinkUrl(base + "a".repeat(2049 - base.length))).toEqual({
      ok: false,
      error: PROJECT_LINK_ERRORS.urlTooLong,
    });
    // Measured after percent-encoding: spaces become three characters each.
    expect(parseLinkUrl(`${base}${" ".repeat(700)}x`).ok).toBe(false);
  });
});

describe("link schemas", () => {
  const add = (values: Record<string, unknown>) =>
    addProjectLinkInputSchema.safeParse({ projectId: ID, url: "https://a.example", ...values });

  test("label: optional, normalized, up to 80, no invisible characters", () => {
    expect(add({}).data?.label).toBeNull();
    expect(add({ label: "  " }).data?.label).toBeNull();
    expect(add({ label: "  Repo   del  proyecto " }).data?.label).toBe("Repo del proyecto");
    expect(add({ label: "a".repeat(80) }).success).toBe(true);
    expect(messages(add({ label: "a".repeat(81) }))).toEqual([PROJECT_LINK_ERRORS.labelTooLong]);
    expect(messages(add({ label: "a‮b" }))).toEqual([PROJECT_LINK_ERRORS.labelInvisible]);
  });

  test("the URL error lands on the url field", () => {
    const result = add({ url: "javascript:alert(1)" });
    expect(result.error?.issues[0].path).toEqual(["url"]);
    expect(result.error?.issues[0].message).toBe(PROJECT_LINK_ERRORS.urlScheme);
  });

  test("position: optional whole number ≥ 0", () => {
    expect(add({ position: 0 }).data?.position).toBe(0);
    expect(add({}).data?.position).toBeUndefined();
    expect(add({ position: -1 }).success).toBe(false);
    expect(add({ position: 1.5 }).success).toBe(false);
  });

  test("ids are uuids (project and link)", () => {
    expect(messages(add({ projectId: "x" }))).toEqual([PROJECT_ERRORS.notFound]);
    expect(
      messages(
        updateProjectLinkInputSchema.safeParse({ projectId: ID, id: "x", url: "https://a.b" }),
      ),
    ).toEqual([PROJECT_LINK_ERRORS.notFound]);
    expect(removeProjectLinkInputSchema.safeParse({ projectId: ID, id: LINK }).success).toBe(true);
    expect(reorderProjectLinksInputSchema.safeParse({ projectId: ID, ids: [LINK] }).success).toBe(
      true,
    );
    expect(reorderProjectLinksInputSchema.safeParse({ projectId: ID, ids: ["x"] }).success).toBe(
      false,
    );
  });

  test("fields outside the schema are dropped", () => {
    const parsed = add({ sortOrder: 5, id: LINK });
    expect(parsed.data).toEqual({ projectId: ID, url: "https://a.example/", label: null });
  });

  test("display text: the label, or the host without www.", () => {
    expect(linkText({ url: "https://www.example.com/a", label: null })).toBe("example.com");
    expect(linkText({ url: "https://example.com/a", label: "Docs" })).toBe("Docs");
    expect(linkHost("not a url")).toBe("not a url");
  });
});

describe("applyLinksChange", () => {
  const a = { id: "a", url: "https://a.example/", label: null };
  const b = { id: "b", url: "https://b.example/", label: "B" };
  const c = { id: "c", url: "https://c.example/", label: null };
  const ids = (links: { id: string }[]) => links.map((link) => link.id);

  test("add at the end, at a position, clamped; never twice", () => {
    expect(ids(applyLinksChange([a, b], { type: "add", link: c }))).toEqual(["a", "b", "c"]);
    expect(ids(applyLinksChange([a, b], { type: "add", link: c, position: 0 }))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(applyLinksChange([a, b], { type: "add", link: c, position: 9 }))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applyLinksChange([a, b], { type: "add", link: a })).toEqual([a, b]);
  });

  test("update, move and remove; unknown ids change nothing", () => {
    expect(
      applyLinksChange([a, b], { type: "update", id: "a", url: "https://z.example/", label: "Z" }),
    ).toEqual([{ id: "a", url: "https://z.example/", label: "Z" }, b]);
    expect(ids(applyLinksChange([a, b, c], { type: "move", id: "c", to: 0 }))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(applyLinksChange([a, b, c], { type: "move", id: "a", to: 1 }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(ids(applyLinksChange([a, b], { type: "remove", id: "a" }))).toEqual(["b"]);
    const links = [a, b];
    expect(applyLinksChange(links, { type: "move", id: "x", to: 0 })).toBe(links);
    expect(applyLinksChange(links, { type: "remove", id: "x" })).toEqual(links);
  });
});
