// N2 (SPEC-notes "Enlaces"): `[[type:uuid|Nombre]]` links in the shared Markdown renderer. The app
// builds every href from the type and the id; nothing a note writes can open another route.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Markdown } from "@/lib/markdown/markdown";
import {
  cleanNoteLinkName,
  formatNoteLink,
  isNoteLinkHref,
  noteLinkHref,
  noteLinkIdsByType,
  parseNoteLinks,
  tokenizeNoteLinks,
  type NoteLinkResolutions,
} from "@/lib/markdown/note-links";
import { goalPath } from "@/modules/goals/routes";
import { habitPath } from "@/modules/habits/routes";
import { trackPath } from "@/modules/learning/routes";
import { notePath } from "@/modules/notes/routes";
import { projectPath } from "@/modules/projects/routes";
import { taskPath } from "@/modules/tasks/routes";

const ID = "0b7c5a0e-1d2f-4a3b-8c4d-5e6f7a8b9c0d";
const ID2 = "1b7c5a0e-1d2f-4a3b-8c4d-5e6f7a8b9c0d";

function dom(
  source: string,
  noteLinks?: NoteLinkResolutions,
  unknownNoteLinks: "deleted" | "saved" = "deleted",
) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <Markdown noteLinks={noteLinks} unknownNoteLinks={unknownNoteLinks}>
      {source}
    </Markdown>,
  );
  return container;
}

const APP_ROUTE = /^\/(notes|projects|tasks|habits|goals|learning)\/[0-9a-f-]{36}$/;

describe("parsing", () => {
  test("a well-formed link of each type", () => {
    for (const type of ["note", "project", "task", "habit", "goal", "learning"] as const) {
      expect(parseNoteLinks(`a [[${type}:${ID}|Ruta AWS]] b`)).toEqual([
        { type, id: ID, name: "Ruta AWS", start: 2, end: 2 + `[[${type}:${ID}|Ruta AWS]]`.length },
      ]);
    }
  });

  test.each([
    ["unknown type", `[[folder:${ID}|X]]`],
    ["id not a uuid", "[[project:123|X]]"],
    ["uppercase id", `[[project:${ID.toUpperCase()}|X]]`],
    ["id too long", `[[project:${ID}0|X]]`],
    ["empty name", `[[project:${ID}|]]`],
    ["blank name", `[[project:${ID}|   ]]`],
    ["no name", `[[project:${ID}]]`],
    ["single brackets", `[project:${ID}|X]`],
    ["name with a line break", `[[project:${ID}|A\nB]]`],
    ["name with a bracket", `[[project:${ID}|A]B]]`],
  ])("not a link: %s", (_name, source) => {
    expect(parseNoteLinks(source)).toEqual([]);
  });

  test("several in a line, and the ids each type needs (deduplicated)", () => {
    const text = `[[project:${ID}|A]] y [[task:${ID2}|B]] y [[project:${ID}|A otra vez]]`;
    expect(parseNoteLinks(text).map((link) => link.name)).toEqual(["A", "B", "A otra vez"]);
    expect(noteLinkIdsByType(text)).toEqual(
      new Map([
        ["project", [ID]],
        ["task", [ID2]],
      ]),
    );
  });

  test("the picker's text never breaks the syntax", () => {
    expect(cleanNoteLinkName(" Ruta [AWS] | IA\n2 ")).toBe("Ruta AWS IA 2");
    expect(formatNoteLink("project", ID, "a|b]")).toBe(`[[project:${ID}|a b]]`);
    expect(formatNoteLink("project", ID, "[]|")).toBe(`[[project:${ID}|…]]`);
    expect(parseNoteLinks(formatNoteLink("task", ID, "<script>]|[x"))).toHaveLength(1);
  });

  test("hand-typed placeholder characters are dropped", () => {
    expect(tokenizeNoteLinks("a\uE0100\uE011b").source).toBe("a0b");
  });

  test("a link escaped with a backslash is not a link", () => {
    expect(parseNoteLinks(`\\[[task:${ID}|x]]`)).toEqual([]);
    // An escaped backslash before it doesn't escape the link.
    expect(parseNoteLinks(`\\\\[[task:${ID}|x]]`)).toHaveLength(1);
  });

  test("the app's routes match each module's detail path", () => {
    expect(noteLinkHref("project", ID)).toBe(projectPath(ID));
    expect(noteLinkHref("task", ID)).toBe(taskPath(ID));
    expect(noteLinkHref("habit", ID)).toBe(habitPath(ID));
    expect(noteLinkHref("goal", ID)).toBe(goalPath(ID));
    expect(noteLinkHref("learning", ID)).toBe(trackPath(ID));
    expect(noteLinkHref("note", ID)).toBe(notePath(ID));
  });

  test.each([
    ["/projects/" + ID, true],
    ["/notes/2026-11-03", true],
    ["/notes/" + ID, true],
    ["/settings", false],
    ["/projects/" + ID + "?x=1", false],
    ["//evil.example/" + ID, false],
    ["https://evil.example/projects/" + ID, false],
    ["/projects/../settings", false],
    ["/finance/" + ID, false],
  ])("isNoteLinkHref(%s) is %s", (href, expected) => {
    expect(isNoteLinkHref(href)).toBe(expected);
  });
});

describe("rendering", () => {
  test("a link opens the entity in the same tab, with the saved name when nothing is resolved", () => {
    const container = dom(`Hablé con Ana sobre [[project:${ID}|Ruta AWS + IA]].`);
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(`/projects/${ID}`);
    expect(link.textContent).toBe("Ruta AWS + IA");
    expect(link.getAttribute("target")).toBe(null);
    expect(link.getAttribute("data-note-link")).toBe("project");
    expect(link.className).toContain("bo-md-note-link");
    expect(link.textContent).not.toContain("pestaña nueva");
    expect(container.textContent).toBe("Hablé con Ana sobre Ruta AWS + IA.");
  });

  test("the resolved name wins (renaming never breaks a link); deleted is text", () => {
    const container = dom(`[[project:${ID}|Viejo]] · [[task:${ID2}|Llamar]]`, {
      [`project:${ID}`]: { name: "Nuevo nombre", href: `/projects/${ID}`, deleted: false },
      [`task:${ID2}`]: { name: "Llamar al banco", href: `/tasks/${ID2}`, deleted: true },
    });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Nuevo nombre");
    expect(container.textContent).toBe("Nuevo nombre · Llamar al banco (ya no existe)");
    // A gone target is muted text.
    expect(container.querySelector(".bo-md-note-link-gone")).toHaveTextContent(
      "Llamar al banco (ya no existe)",
    );
  });

  test("resolved for exactly this text (the server's render), a link it didn't find is gone", () => {
    const container = dom(`[[goal:${ID}|Correr 10K]]`, {}, "deleted");
    expect(container.querySelector("a")).toBe(null);
    expect(container.textContent).toBe("Correr 10K (ya no existe)");
  });

  test("the editor's text: a link nobody looked up yet is a link with its saved name", () => {
    const container = dom(
      `[[goal:${ID}|Correr 10K]] y [[task:${ID2}|Llamar]]`,
      { [`task:${ID2}`]: { name: "Llamar", href: `/tasks/${ID2}`, deleted: true } },
      "saved",
    );
    expect(container.querySelector("a")).toHaveAttribute("href", `/goals/${ID}`);
    expect(container.querySelector("a")).toHaveTextContent("Correr 10K");
    // What the server did resolve still counts.
    expect(container.textContent).toContain("Llamar (ya no existe)");
  });

  test("external links carry an icon and «new tab» (a `[[…]]` link has neither)", () => {
    const container = dom(`[a](https://example.com) [[project:${ID}|B]]`);
    const [external, internal] = container.querySelectorAll("a");
    expect(external.querySelector("svg.bo-md-external-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(external).toHaveTextContent("(se abre en una pestaña nueva)");
    expect(internal.querySelector("svg")).toBe(null);
  });

  test.each([
    ["hexadecimal", "&#xE010;0&#xE011;"],
    ["decimal", "&#57360;0&#57361;"],
    ["with a guessed nonce", "&#xE010;abcd1234:0&#xE011;"],
  ])("a placeholder can't be forged with %s character references", (_name, forged) => {
    const container = dom(`[[project:${ID}|Real]] ${forged}`);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Real");
  });

  test("an escaped link shows as written, without the backslash", () => {
    const container = dom(`\\[[task:${ID}|x]]`);
    expect(container.querySelector("a")).toBe(null);
    expect(container.textContent).toBe(`[[task:${ID}|x]]`);
  });

  test("a code block's language and meta keep the link text as written", () => {
    const raw = `[[project:${ID}|R]]`;
    const container = dom(`\`\`\`${raw} ${raw}\ncode\n\`\`\``);
    expect(container.querySelector("a")).toBe(null);
    expect(container.innerHTML).not.toContain("\uE010");
  });

  test("a resolved href outside the app's routes is ignored (built from the type and id)", () => {
    const container = dom(`[[note:${ID}|Nota]]`, {
      [`note:${ID}`]: { name: "Nota", href: "https://evil.example", deleted: false },
    });
    expect(container.querySelector("a")!.getAttribute("href")).toBe(`/notes/${ID}`);
  });

  test("a daily note opens its day", () => {
    const container = dom(`[[note:${ID}|3 nov]]`, {
      [`note:${ID}`]: { name: "Lunes 3 de noviembre", href: "/notes/2026-11-03", deleted: false },
    });
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/notes/2026-11-03");
  });

  test("names with HTML or Markdown are text: no tags, no emphasis, no table cells", () => {
    const container = dom(
      `[[project:${ID}|<script>alert(1)</script>]] [[task:${ID2}|*a* \`b\` _c_ <b>d</b>]]`,
    );
    expect(container.querySelector("script, b, em, code, table")).toBe(null);
    const links = [...container.querySelectorAll("a")].map((link) => link.textContent);
    expect(links).toEqual(["<script>alert(1)</script>", "*a* `b` _c_ <b>d</b>"]);
  });

  test("names with ] or | written by hand don't make a link", () => {
    const container = dom(`[[project:${ID}|A]B]] y [[project:${ID}|A|B]]`);
    expect(container.querySelector("a")).toBe(null);
  });

  test("inside code (inline or block) a link doesn't count and stays as written", () => {
    const raw = `[[project:${ID}|Ruta]]`;
    const container = dom(`\`${raw}\`\n\n\`\`\`\n${raw}\n\`\`\`\n\n    ${raw}`);
    expect(container.querySelector("a")).toBe(null);
    const codes = [...container.querySelectorAll("code")].map((code) => code.textContent?.trim());
    expect(codes).toEqual([raw, raw, raw]);
  });

  test("several in a line, inside emphasis, lists and tables", () => {
    const container = dom(
      `- **[[project:${ID}|A]]** y [[habit:${ID2}|B]]\n\n| x |\n| - |\n| [[goal:${ID}|C]] |`,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual(["A", "B", "C"]);
    expect(container.querySelector("strong a")).not.toBe(null);
    expect(container.querySelectorAll("td")).toHaveLength(1);
  });

  test("inside another link only the name shows (no link in a link)", () => {
    const container = dom(`[ver [[project:${ID}|A]]](https://example.com)`);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].textContent).toContain("ver A");
  });

  test("a link's text inside a URL stays as written", () => {
    const container = dom(`[x](https://example.com/[[project:${ID}|A]])`);
    expect(container.querySelector("a")?.getAttribute("href")).not.toContain("\uE010");
  });

  test("a path written by hand is never an app link", () => {
    const container = dom(`[a](/projects/${ID}) [b](/settings) [c](//evil.example)`);
    expect(container.querySelector("a")).toBe(null);
  });

  test("no href ever leaves the app's routes, whatever the note says", () => {
    // [source, how many links it must produce] (a positive control: zero links passes trivially).
    const sources: [string, number][] = [
      [`[[project:${ID}|x]](javascript:alert(1))`, 1],
      [`[[project:${ID}|x]]`, 1],
      [`[[note:${ID}|<a href="javascript:alert(1)">y</a>]]`, 1],
      [`<a data-note-link="project" href="/settings">z</a>`, 0],
      [`[[project:${ID}|x]] [y](/projects/${ID} "t")`, 1],
    ];
    for (const [source, count] of sources) {
      const links = dom(source).querySelectorAll("a");
      expect(links).toHaveLength(count);
      for (const link of links) expect(link.getAttribute("href") ?? "").toMatch(APP_ROUTE);
    }
  });
});
