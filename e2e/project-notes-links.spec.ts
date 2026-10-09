import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { afterSaveSettled } from "./support/saves";
import { fontsLoaded } from "./support/fonts";
import { NOTES_FIXTURE, setNotesAndLinks } from "./support/project-notes-links";
import {
  insertProject,
  isDesktop,
  notices,
  openProject,
  uniqueName,
  untilSaved,
} from "./support/projects";
import { expectScreenshot } from "./support/screenshots";
import path from "node:path";

// P5: a project's notes (Markdown) and links. Tests that edit work on their own project
// (inserted in "Hobbies" with a unique name), so they run in parallel without a lock; the
// screenshots show the read-only NOTES_FIXTURE.

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = [path.join(__dirname, "support/hide-app-nav.css")];

async function axeViolations(page: Page) {
  // Nothing saving, the title back and no transition running (axe would read mid-fade colors).
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const notesSection = (page: Page) => page.getByRole("region", { name: "Notas" });
const linksSection = (page: Page) => page.getByRole("region", { name: /^Enlaces/ });
const notesField = (page: Page) => page.getByRole("textbox", { name: "Notas en Markdown" });
const linkList = (page: Page) => page.getByRole("list", { name: "Enlaces del proyecto" });

/** Fails the test if any alert, confirm or prompt opens (beforeunload is checked on its own). */
function failOnDialogs(page: Page) {
  const opened: string[] = [];
  page.on("dialog", async (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  return opened;
}

test("write Markdown, preview it, save, and see it rendered (also after a reload)", async ({
  page,
}, testInfo) => {
  const dialogs = failOnDialogs(page);
  const id = await insertProject({ name: uniqueName("Huerto", testInfo) });
  await openProject(page, id);
  await expect(notesSection(page)).toContainText("Sin notas.");

  await notesSection(page).getByRole("button", { name: "Escribir notas" }).click();
  await expect(notesField(page)).toBeFocused();
  await notesField(page).fill(
    "# Siembra\n\n- [x] Comprar tierra\n- [ ] Tomates\n\n| Planta | Riego |\n| -- | -- |\n| Albahaca | Diario |\n\nVer [guía](https://example.com/huerto).",
  );

  // Vista previa: WAI-ARIA tabs, with the arrow keys.
  const write = page.getByRole("tab", { name: "Escribir" });
  const preview = page.getByRole("tab", { name: "Vista previa" });
  await expect(write).toHaveAttribute("aria-selected", "true");
  await write.focus();
  await page.keyboard.press("ArrowRight");
  await expect(preview).toBeFocused();
  await expect(preview).toHaveAttribute("aria-selected", "true");
  const previewPanel = page.getByRole("tabpanel", { name: "Vista previa" });
  await expect(previewPanel.getByRole("heading", { level: 3, name: "Siembra" })).toBeVisible();
  await expect(previewPanel.getByRole("table")).toContainText("Albahaca");
  await expect(notesField(page)).toBeHidden();

  await untilSaved(page, () => notesSection(page).getByRole("button", { name: "Guardar" }).click());
  await expect(notesSection(page).getByRole("button", { name: "Editar notas" })).toBeFocused();
  const rendered = notesSection(page);
  await expect(rendered.getByRole("heading", { level: 3, name: "Siembra" })).toBeVisible();
  await expect(page.locator("[data-detail-announcer]")).toHaveText("Se guardaron las notas.");

  await page.reload();
  await expect(rendered.getByRole("heading", { level: 3, name: "Siembra" })).toBeVisible();
  await expect(rendered.getByRole("listitem").first()).toHaveText("Hecho: Comprar tierra");
  await expect(rendered.getByRole("cell", { name: "Diario" })).toBeVisible();
  const link = rendered.getByRole("link", { name: /guía/ });
  await expect(link).toHaveAttribute("href", "https://example.com/huerto");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  // Rendered on the server: no textarea, no Markdown source on the page.
  await expect(rendered).not.toContainText("# Siembra");
  expect(dialogs).toEqual([]);
});

/**
 * What a rendered note must never contain: active elements, event handlers, inline styles,
 * unsafe or off-site-relative URLs, and in-page links that point nowhere. Returns the offenders.
 */
async function offenders(root: Locator) {
  return root.evaluate((element) => {
    const found: string[] = [];
    for (const node of element.querySelectorAll(
      "script, iframe, img, svg:not(.lucide), object, embed, form",
    )) {
      found.push(node.tagName);
    }
    for (const node of element.querySelectorAll("*")) {
      for (const name of node.getAttributeNames()) {
        const value = node.getAttribute(name) ?? "";
        if (name.startsWith("on") || name === "style") found.push(`${node.tagName}[${name}]`);
        if (["href", "src"].includes(name)) {
          if (!/^(#|mailto:|https?:\/\/)/i.test(value))
            found.push(`${node.tagName}[${name}=${value}]`);
          if (
            value.startsWith("#") &&
            !element.querySelector(`[id="${CSS.escape(value.slice(1))}"]`)
          ) {
            found.push(`dangling ${value}`);
          }
        }
      }
    }
    return found;
  });
}

test("malicious Markdown renders inert, in the preview and saved: no dialog, nothing unsafe", async ({
  page,
}, testInfo) => {
  const dialogs = failOnDialogs(page);
  const id = await insertProject({ name: uniqueName("XSS", testInfo) });
  const payload = [
    "<script>alert('script')</script>",
    "<img src=x onerror=\"alert('img')\">",
    "<svg onload=\"alert('svg')\"></svg>",
    "<iframe src=\"javascript:alert('iframe')\"></iframe>",
    "<a href=\"javascript:alert('raw-a')\">raw</a>",
    '<div onmouseover="alert(\'div\')" style="position:fixed;inset:0">capa</div>',
    "[js](javascript:alert('md'))",
    "[JS](JaVaScRiPt:alert('md2'))",
    "[ent](&#106;avascript:alert('ent'))",
    "[tab](java&#9;script:alert('tab'))",
    "[nl](java&#10;script:alert('nl'))",
    "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[vb](vbscript:msgbox('vb'))",
    "[rel](//evil.example/x)",
    "[bs](/\\evil.example/x)",
    "[bs2](\\\\evil.example/x)",
    "![img](javascript:alert('md-img'))",
    "<javascript:alert('autolink')>",
    "Con nota[^1].",
    "[^1]: La nota.",
  ].join("\n\n");
  const clickable = ["js", "JS", "ent", "tab", "nl", "data", "vb", "rel", "bs", "bs2", "raw"];

  await openProject(page, id);
  await notesSection(page).getByRole("button", { name: "Escribir notas" }).click();
  await notesField(page).fill(payload);

  // The client preview first: the same renderer, in the browser.
  await page.getByRole("tab", { name: "Vista previa" }).click();
  const preview = page.getByRole("tabpanel", { name: "Vista previa" });
  await expect(preview).toContainText("La nota.");
  expect(await offenders(preview)).toEqual([]);
  for (const text of clickable) {
    await preview.getByText(text, { exact: true }).first().click();
  }
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));

  await untilSaved(page, () => notesSection(page).getByRole("button", { name: "Guardar" }).click());
  await page.reload();

  // Then the saved notes, rendered on the server.
  const section = notesSection(page);
  // HTML blocks (the div layer, the script) are dropped whole; inline tags leave their text.
  await expect(section).toContainText("raw");
  await expect(section).not.toContainText("capa");
  expect(await offenders(section)).toEqual([]);
  // Footnotes still work: a single prefix, and the reference reaches its note.
  await expect(section.locator("[id^='user-content-user-content-']")).toHaveCount(0);
  await expect(section.locator("a[data-footnote-ref]")).toHaveAttribute(
    "href",
    "#user-content-fn-1",
  );
  for (const text of clickable) {
    await section.getByText(text, { exact: true }).first().click();
  }
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
  expect(dialogs).toEqual([]);
});

test("unsaved notes: leaving asks first, inside the page", async ({ page }, testInfo) => {
  const id = await insertProject({ name: uniqueName("Garaje", testInfo) });
  await openProject(page, id);
  const back = page.getByRole("link", { name: "Volver a Proyectos" });

  await notesSection(page).getByRole("button", { name: "Escribir notas" }).click();
  // Positive control: with nothing typed, nothing asks.
  await notesSection(page).getByRole("button", { name: "Cancelar" }).click();
  await back.click();
  await expect(page).toHaveURL(/\/projects$/);
  await openProject(page, id);

  await notesSection(page).getByRole("button", { name: "Escribir notas" }).click();
  await notesField(page).fill("Borrador que no quiero perder");
  await back.click();
  const confirm = page.getByRole("group", { name: "Tienes cambios sin guardar en las notas." });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
  await expect(confirm.getByRole("button", { name: "Seguir editando" })).toBeFocused();
  await confirm.getByRole("button", { name: "Seguir editando" }).click();
  await expect(confirm).toBeHidden();
  await expect(notesField(page)).toBeFocused();
  await expect(notesField(page)).toHaveValue("Borrador que no quiero perder");

  // Number shortcuts (desktop) go through the same question.
  if (isDesktop(testInfo)) {
    await page.getByRole("tab", { name: "Vista previa" }).click();
    await page.keyboard.press("1");
    await expect(confirm).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
    await confirm.getByRole("button", { name: "Seguir editando" }).click();
  }

  // Closing the tab or reloading: the browser's own prompt.
  const beforeUnload: string[] = [];
  page.on("dialog", async (dialog) => {
    beforeUnload.push(dialog.type());
    await dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => beforeUnload).toEqual(["beforeunload"]);
});

test("unsaved notes: 'Salir sin guardar' leaves, and the notes stay as they were", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Ático", testInfo) });
  await setNotesAndLinks(id, { notes: "Original" });
  await openProject(page, id);
  await notesSection(page).getByRole("button", { name: "Editar notas" }).click();
  await notesField(page).fill("Cambiado");
  await page.getByRole("link", { name: "Volver a Proyectos" }).click();
  await page.getByRole("button", { name: "Salir sin guardar" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await openProject(page, id);
  await expect(notesSection(page)).toContainText("Original");
});

test("links: add, edit, reorder, remove and undo; each survives a reload", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Taller", testInfo) });
  await openProject(page, id);
  await expect(linksSection(page)).toContainText("Sin enlaces.");

  // Add: only http(s); without a scheme, https:// is assumed.
  await page.getByRole("button", { name: "Agregar enlace" }).click();
  const url = page.getByRole("textbox", { name: "Dirección" });
  await expect(url).toBeFocused();
  await url.fill("javascript:alert(1)");
  await url.press("Enter");
  await expect(url).toHaveAccessibleDescription("Solo se aceptan direcciones http:// o https://.");
  await url.fill("ftp://example.com/archivo");
  await url.press("Enter");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await url.fill("example.com/planos");
  await page.getByRole("textbox", { name: "Etiqueta" }).fill("Planos");
  await untilSaved(page, () => url.press("Enter"));
  await expect(page.getByRole("button", { name: "Agregar enlace" })).toBeFocused();

  await page.getByRole("button", { name: "Agregar enlace" }).click();
  await page.getByRole("textbox", { name: "Dirección" }).fill("https://www.example.org/manual");
  await untilSaved(page, () => page.getByRole("textbox", { name: "Dirección" }).press("Enter"));

  const names = () =>
    linkList(page)
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.firstElementChild?.textContent ?? ""));
  await expect.poll(names).toEqual(["Planos", "example.org"]);
  const planos = linkList(page).getByRole("link", { name: /Planos/ });
  await expect(planos).toHaveAttribute("href", "https://example.com/planos");
  await expect(planos).toHaveAttribute("target", "_blank");
  await expect(planos).toHaveAttribute("rel", "noopener noreferrer nofollow");

  // Edit the second one's label.
  await page.getByRole("button", { name: "Editar enlace example.org" }).click();
  await page.getByRole("textbox", { name: "Etiqueta" }).fill("Manual");
  await untilSaved(page, () => page.getByRole("button", { name: "Guardar" }).click());
  await expect(page.getByRole("button", { name: "Editar enlace Manual" })).toBeFocused();

  // Reorder with Subir: focus stays on the key.
  await untilSaved(page, () => page.getByRole("button", { name: "Subir Manual" }).click());
  await expect(page.getByRole("button", { name: "Subir Manual" })).toBeFocused();
  await expect.poll(names).toEqual(["Manual", "Planos"]);
  await page.reload();
  await expect.poll(names).toEqual(["Manual", "Planos"]);

  // Remove, then undo from the notice: back in its place.
  await page.getByRole("button", { name: "Editar enlace Manual" }).click();
  await untilSaved(page, () => page.getByRole("button", { name: "Quitar enlace" }).click());
  await expect.poll(names).toEqual(["Planos"]);
  await expect(notices(page)).toContainText("Se quitó «Manual».");
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect.poll(names).toEqual(["Manual", "Planos"]);
  await page.reload();
  await expect.poll(names).toEqual(["Manual", "Planos"]);
  await expect(linkList(page).getByRole("link", { name: /Manual/ })).toHaveAttribute(
    "href",
    "https://www.example.org/manual",
  );
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshots @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/projects");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    // A full load, so the stored theme applies from the first paint.
    const href = await page.getByRole("link", { name: NOTES_FIXTURE.name }).getAttribute("href");
    await page.goto(href ?? "");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOTES_FIXTURE.name);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    await fontsLoaded(page);

    await expect(notesSection(page).getByRole("table")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(notesSection(page), `project-notes-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
    await expectScreenshot(linksSection(page), `project-links-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });

    // The editors, opened and closed without saving (read-only fixture).
    await notesSection(page).getByRole("button", { name: "Editar notas" }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("tab", { name: "Vista previa" }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Vista previa" }).getByRole("table"),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await notesSection(page).getByRole("button", { name: "Cancelar" }).click();

    await page.getByRole("button", { name: "Editar enlace Lista compartida" }).click();
    await page.getByRole("textbox", { name: "Dirección" }).fill("ftp://x");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("textbox", { name: "Dirección" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Editar enlace Lista compartida" }),
    ).toBeFocused();
  });
}
