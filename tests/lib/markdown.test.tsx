// P5: the shared Markdown renderer (src/lib/markdown). Untrusted input must come out inert:
// no scripts, no event handlers, no unsafe URL schemes, no raw HTML; GFM still renders.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Markdown } from "@/lib/markdown/markdown";
import { isExternalHref, linkKind } from "@/lib/markdown/schema";

const html = (source: string, headingOffset?: 0 | 1 | 2) =>
  renderToStaticMarkup(<Markdown headingOffset={headingOffset}>{source}</Markdown>);

/** The rendered output as a DOM, to inspect elements and attributes (not text). */
function dom(source: string) {
  const container = document.createElement("div");
  container.innerHTML = html(source);
  return container;
}

/** Every attribute value in the output that holds a URL. */
function urls(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[href], [src], [cite], [action], [formaction]")].flatMap(
    (element) =>
      ["href", "src", "cite", "action", "formaction"]
        .map((name) => element.getAttribute(name))
        .filter((value): value is string => value !== null),
  );
}

const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

function expectInert(container: HTMLElement) {
  expect(container.querySelector("script, iframe, object, embed, style, form, img, svg")).toBe(
    null,
  );
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames()) {
      expect(attribute).not.toMatch(/^on/i);
      expect(attribute).not.toBe("style");
      expect(attribute).not.toBe("node");
    }
  }
  for (const url of urls(container)) expect(url).not.toMatch(UNSAFE_SCHEME);
}

describe("sanitization", () => {
  test.each([
    ["script block", "<script>alert(1)</script>"],
    ["inline script", "Hola <script>alert(1)</script> mundo"],
    ["img onerror", '<img src="x" onerror="alert(1)">'],
    ["svg onload", "<svg onload=alert(1)></svg>"],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["event handler on a div", '<div onclick="alert(1)">clic</div>'],
    ["style", "<style>body{display:none}</style>"],
    ["form", '<form action="https://evil.example"><button>Enviar</button></form>'],
  ])("raw HTML is stripped, never rendered as markup: %s", (_name, source) => {
    const container = dom(source);
    expectInert(container);
    // Not even as visible tags: the raw nodes are dropped.
    expect(container.textContent).not.toContain("<");
  });

  test("text around (and between) stripped tags stays", () => {
    expect(dom("Hola <b onclick=alert(1)>mundo</b>").textContent).toBe("Hola mundo");
  });

  test.each([
    ["javascript:", "[clic](javascript:alert(1))"],
    ["mixed case", "[clic](JaVaScRiPt:alert(1))"],
    ["entity-encoded", "[clic](&#106;avascript:alert(1))"],
    ["leading spaces", "[clic]( javascript:alert(1))"],
    ["data:", "[clic](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["vbscript:", "[clic](vbscript:msgbox(1))"],
    ["file:", "[clic](file:///etc/passwd)"],
    ["reference link", "[clic][x]\n\n[x]: javascript:alert(1)"],
    ["autolink", "<javascript:alert(1)>"],
    ["image", "![foto](javascript:alert(1))"],
    ["data image", "![foto](data:image/png;base64,iVBORw0KGgo=)"],
  ])("unsafe link schemes are dropped: %s", (_name, source) => {
    const container = dom(source);
    expectInert(container);
  });

  test("a link with an unsafe scheme keeps its text, without a target", () => {
    const container = dom("[clic](javascript:alert(1))");
    expect(container.textContent).toContain("clic");
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
  });

  test("http(s) links open in a new tab without opener, referrer or follow", () => {
    const container = dom("[Docs](https://example.com/docs) y https://example.org");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/docs",
      "https://example.org",
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
      expect(link.textContent).toContain("(se abre en una pestaña nueva)");
    }
  });

  test("mailto links stay in the tab; irc and xmpp are not links", () => {
    const container = dom("[escribir](mailto:yo@example.com) [chat](irc://irc.example.com)");
    const mail = container.querySelector("a[href^='mailto:']");
    expect(mail).not.toBeNull();
    expect(mail).not.toHaveAttribute("target");
    expect(container.querySelector("a[href^='irc:']")).toBeNull();
  });

  test("images are never loaded: an http(s) one becomes a link with its description", () => {
    const container = dom("![Plano de la cocina](https://example.com/plano.png)");
    expect(container.querySelector("img")).toBeNull();
    const link = container.querySelector("a")!;
    expect(link).toHaveAttribute("href", "https://example.com/plano.png");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link.textContent).toContain("Imagen: Plano de la cocina");
  });

  test("ids can't clobber the page's: they get the prefix once", () => {
    const container = dom("Texto[^1]\n\n[^1]: Nota.");
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.startsWith("user-content-")).toBe(true);
      expect(id).not.toContain("user-content-user-content-");
    }
  });

  test("every in-page link points to an element that exists (footnotes both ways)", () => {
    const container = dom("Uno[^a] y dos[^b].\n\n[^a]: Primera.\n[^b]: Segunda.\n\n[arriba](#top)");
    const fragments = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='#']")];
    expect(fragments.length).toBeGreaterThanOrEqual(4);
    for (const link of fragments.filter((a) => a.textContent !== "arriba")) {
      const target = link.getAttribute("href")!.slice(1);
      expect(container.querySelector(`[id="${target}"]`), target).not.toBeNull();
    }
    // A hand-written fragment is prefixed the same way (it can only reach the note's own ids).
    expect(container.querySelector("a[href='#user-content-top']")).not.toBeNull();
    // aria-describedby of the references names the (prefixed) label.
    const label = container.querySelector("a[data-footnote-ref]")?.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${label}"]`)).not.toBeNull();
  });

  test.each([
    ["protocol-relative", "[clic](//evil.example/x)"],
    ["slash backslash", "[clic](/\\evil.example/x)"],
    ["double backslash", "[clic](\\\\evil.example/x)"],
    ["path", "[clic](/projects)"],
    ["relative", "[clic](otra/pagina)"],
    ["reference", "[clic][r]\n\n[r]: //evil.example"],
  ])("only #, mailto and http(s) are links; %s is text", (_name, source) => {
    const container = dom(source);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("clic");
  });

  test("linkKind", () => {
    expect(linkKind("#user-content-fn-1")).toBe("fragment");
    expect(linkKind("MAILTO:a@b.c")).toBe("mailto");
    expect(linkKind(" https://a.b ")).toBe("external");
    for (const href of ["//evil", "/\\evil", "\\\\evil", "/x", "x", "javascript:1", "#a b"]) {
      expect(linkKind(href), href).toBeNull();
    }
  });

  test("isExternalHref", () => {
    expect(isExternalHref("https://a.b")).toBe(true);
    expect(isExternalHref("HTTP://a.b")).toBe(true);
    expect(isExternalHref("#user-content-fn-1")).toBe(false);
    expect(isExternalHref("mailto:a@b.c")).toBe(false);
    expect(isExternalHref("javascript:alert(1)")).toBe(false);
  });
});

describe("GitHub Flavored Markdown", () => {
  test("tables scroll inside a focusable box, with alignment", () => {
    const container = dom("| Ítem | Costo |\n| :-- | --: |\n| Pintura | 120 |");
    const box = container.querySelector(".bo-md-table")!;
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("role", "group");
    expect(box).toHaveAttribute("aria-label", "Tabla");
    expect(box.querySelector("table th")?.textContent).toBe("Ítem");
    // react-markdown turns the alignment into an inline text-align.
    expect(box.querySelector<HTMLElement>("td:last-child")?.style.textAlign).toBe("right");
  });

  test("task lists are drawn read-only and read as Hecho / Pendiente", () => {
    const container = dom("- [x] Comprar pintura\n- [ ] Pintar");
    expect(container.querySelector("input")).toBeNull();
    const items = [...container.querySelectorAll("li")];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Hecho: Comprar pintura",
      "Pendiente: Pintar",
    ]);
    expect(items[0].querySelector(".bo-md-check.is-checked")).toHaveAttribute("aria-hidden");
    expect(items[1].querySelector(".bo-md-check:not(.is-checked)")).not.toBeNull();
  });

  test("strikethrough, emphasis, code and quotes", () => {
    const container = dom(
      "~~viejo~~ **fuerte** _suave_ `code`\n\n> cita\n\n```ts\nconst a = 1;\n```",
    );
    expect(container.querySelector("del")?.textContent).toBe("viejo");
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelector("em")?.textContent).toBe("suave");
    expect(container.querySelector("p code")?.textContent).toBe("code");
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe("cita");
    expect(container.querySelector("pre code")).toHaveClass("language-ts");
  });

  test("autolinks a bare www address", () => {
    const link = dom("Ver www.example.com").querySelector("a")!;
    expect(link).toHaveAttribute("href", "http://www.example.com");
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("footnotes in Spanish", () => {
    const container = dom("Texto[^1]\n\n[^1]: La nota.");
    expect(container.textContent).toContain("Notas al pie");
    expect(container.querySelector("a[data-footnote-backref]")).toHaveAttribute(
      "aria-label",
      "Volver al texto",
    );
  });

  test("headings move down by the offset and keep the look of the written level", () => {
    const container = document.createElement("div");
    container.innerHTML = html("# Uno\n\n## Dos\n\n###### Seis", 2);
    expect(container.querySelector("h3.bo-md-h1")?.textContent).toBe("Uno");
    expect(container.querySelector("h4.bo-md-h2")?.textContent).toBe("Dos");
    // Clamped at h6.
    expect(container.querySelector("h6.bo-md-h6")?.textContent).toBe("Seis");
    expect(container.querySelector("h1, h2")).toBeNull();
  });

  test("the footnotes' heading sits one level under the section (h3 with offset 2)", () => {
    const container = document.createElement("div");
    container.innerHTML = html("Texto[^1]\n\n[^1]: Nota.", 2);
    const label = container.querySelector("#user-content-footnote-label")!;
    expect(label.tagName).toBe("H3");
    expect(label).toHaveClass("sr-only");
    expect(label.textContent).toBe("Notas al pie");
  });

  test("wrapped in .bo-markdown; plain text stays text", () => {
    expect(html("Hola")).toBe('<div class="bo-markdown"><p>Hola</p></div>');
  });
});
