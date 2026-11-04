import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { dailyTitle } from "@/modules/notes/note-day";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  insertDailyNote,
  insertPageNote,
  openNotes,
  readDailyNote,
  readTask,
  test,
  untilNoteSaved,
} from "./support/notes";
import { insertProject, isDesktop, openProject, uniqueName, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// N4 of `notes`: the module's ONE E2E spec (CI budget). The way the owner uses it: today's note
// from Hoy («Nota de hoy»), writing until «Guardado» and a reload that keeps it; `[[` + text to
// link a project picked from the list, the link in the note and «Aparece en 1 nota» on the
// project; a `- [ ]` line turned into a task and its live checkbox (the task is done); a search
// without the accent that finds the note with its fragment. Axe in both themes (list, search,
// note, editor with the `[[` picker closed); 320 px without sideways scroll; one screenshot (the
// search results). Every test holds the notes lock and starts and ends with no notes
// (e2e/support/notes.ts).
//
// Lima's midnight: the first test writes today's note; a run that crosses 00:00 (Lima) between
// opening it and checking it fails. Re-run before debugging (CLAUDE.md, «polish»).

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = path.join(__dirname, "support/hide-app-nav.css");

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const bodyField = (page: Page) => page.getByRole("textbox", { name: "Texto de la nota" });
const noteView = (page: Page) => page.locator("[data-note-view]");
const searchField = (page: Page) => page.getByRole("searchbox", { name: "Buscar en notas" });
const results = (page: Page) => page.getByRole("list", { name: "Resultados de la búsqueda" });

/** Searches from /notes with Enter and waits for the results' URL. */
async function search(page: Page, text: string) {
  await searchField(page).fill(text);
  await expect(searchField(page)).toHaveValue(text);
  await searchField(page).press("Enter");
  await expect(page).toHaveURL(`/notes?${new URLSearchParams({ q: text })}`);
}

test("today's note from Hoy: write, link a project, a line becomes a task, and search it @today-tasks", async ({
  page,
}, testInfo) => {
  // A long flow (Hoy, the editor, three reloads, the project and the search).
  test.slow();
  const today = ownerDateKey(new Date());
  const projectName = uniqueName("Ruta QA", testInfo);
  const projectId = await insertProject({ name: projectName });

  // Hoy: «Nota de hoy» opens today's note in the editor, the cursor in the text.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  const todayKey = page.locator("[data-today-note-key]");
  await expect(todayKey).toHaveAccessibleName("Nota de hoy");
  await todayKey.click();
  await expect(page).toHaveURL(`/notes/${today}`);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(bodyField(page)).toBeFocused();

  // Write: «Guardado» without a key, and a reload keeps it.
  await bodyField(page).pressSequentially("Hoy revisé las políticas del gimnasio.");
  await expect(bodyField(page)).toHaveValue("Hoy revisé las políticas del gimnasio.");
  await untilNoteSaved(page);
  expect((await readDailyNote(today))?.body).toBe("Hoy revisé las políticas del gimnasio.");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(noteView(page)).toContainText("Hoy revisé las políticas del gimnasio.");

  // `[[` + text: the picker lists the project under the field; picking it writes the link.
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(bodyField(page)).toBeFocused();
  await bodyField(page).press("ControlOrMeta+End");
  await bodyField(page).press("Enter");
  await bodyField(page).press("Enter");
  await bodyField(page).pressSequentially(`Hablé de [[${projectName.slice(0, 12)}`);
  const option = page.getByRole("option", { name: new RegExp(projectName) });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(bodyField(page)).toHaveValue(
    new RegExp(`Hablé de \\[\\[project:${projectId}\\|${projectName}\\]\\]$`),
  );
  await expect(bodyField(page)).toBeFocused();

  // A task line, then «Listo»: everything saved, back to the view.
  await bodyField(page).press("Enter");
  await bodyField(page).press("Enter");
  await bodyField(page).pressSequentially("- [ ] [QA] llamar");
  await expect(bodyField(page)).toHaveValue(/- \[ \] \[QA\] llamar$/);
  await untilNoteSaved(page);
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByRole("button", { name: "Editar" })).toBeFocused();
  await expect.poll(async () => (await readDailyNote(today))?.body).toMatch(/\[QA\] llamar$/);

  // The server's render: the link opens the project; the line offers «Convertir en tarea».
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(noteView(page).getByRole("link", { name: projectName })).toHaveAttribute(
    "href",
    `/projects/${projectId}`,
  );
  await untilSaved(page, () =>
    page.getByRole("button", { name: "Convertir en tarea: [QA] llamar" }).click(),
  );
  // The task is in the inbox and the line is now its link (a link's saved name has no brackets).
  await expect.poll(async () => (await readTask("[QA] llamar"))?.id).toBeTruthy();
  const task = await readTask("[QA] llamar");
  expect(task).toMatchObject({ doneAt: null, deletedAt: null, projectId: null });
  expect((await readDailyNote(today))?.body).toMatch(
    new RegExp(`- \\[\\[task:${task.id}\\|QA llamar\\]\\]$`),
  );
  // The box is named by the link's name, cleaned like every link name (`cleanNoteLinkName`: `[`, `]`
  // and `|` become spaces), so «[QA] llamar» reads «QA llamar». The reload brings the server's render.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  const check = page.getByRole("checkbox", { name: "Hecha: QA llamar" });
  await expect(check).toBeVisible();
  await expect(check).not.toBeChecked();

  // The live checkbox completes the task itself.
  await untilSaved(page, () => check.click());
  await expect(check).toBeChecked();
  await expect.poll(async () => (await readTask("[QA] llamar"))?.doneAt).not.toBeNull();

  // The project: «Aparece en 1 nota», today's note by its long date.
  await openProject(page, projectId);
  const mentions = page.getByRole("region", { name: "Aparece en 1 nota" });
  await expect(mentions.getByRole("link", { name: dailyTitle(today, today) })).toHaveAttribute(
    "href",
    `/notes/${today}`,
  );

  // Search without the accent: the note, with the found word marked in its fragment.
  await openNotes(page);
  await search(page, "politicas");
  const found = results(page).getByRole("link", { name: new RegExp(dailyTitle(today, today)) });
  await expect(found).toHaveAttribute("href", `/notes/${today}`);
  await expect(found.locator("mark")).toHaveText("políticas");
  // ts_headline picks the words around the match (the start of the body may be left out).
  await expect(found).toContainText("revisé las políticas del gimnasio.");
  // The link counts by its name in the fragment, never as `[[…]]`.
  await expect(results(page)).not.toContainText("[[");

  // Clearing goes back to the list, with the focus in the field.
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(page).toHaveURL("/notes");
  await expect(searchField(page)).toBeFocused();
  await expect(page.getByRole("list", { name: "Notas", exact: true })).toBeVisible();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (list, search, note and editor)`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const today = ownerDateKey(new Date());
    const projectName = uniqueName("Ruta AWS", testInfo);
    const projectId = await insertProject({ name: projectName });
    const id = await insertPageNote(
      "Apuntes IAM",
      `# IAM\n\nLas **políticas** se evalúan antes de cada petición. Ver [[project:${projectId}|${projectName}]].\n\n- [ ] Repasar las políticas de S3\n`,
    );
    await insertDailyNote(today, "Hablé con Ana sobre las políticas del equipo.");

    await openNotes(page);
    await setTheme(page, theme);
    const list = page.getByRole("list", { name: "Notas", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    expect(await axeViolations(page)).toEqual([]);

    await search(page, "polit");
    await expect(results(page).getByRole("listitem")).toHaveCount(2);
    expect(await axeViolations(page)).toEqual([]);

    await openNotes(page, `/notes/${id}`);
    await expect(page.getByRole("button", { name: /^Convertir en tarea/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // The editor, with the `[[` picker closed.
    await page.getByRole("button", { name: "Editar" }).click();
    await expect(bodyField(page)).toBeFocused();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px the search and a note don't scroll sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const id = await insertPageNote(
    "Una nota de conocimiento con un título bastante largo para una pantalla angosta",
    "Las políticas de una cuenta con un texto bastante largo para una pantalla muy angosta: ninguna palabra debería empujar la página hacia el costado.",
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await openNotes(page);
  await search(page, "politicas cuenta");
  await expect(results(page).getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await openNotes(page, `/notes/${id}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("the search results: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await insertPageNote(
    "Apuntes IAM",
    "Las políticas de IAM se evalúan antes de cada petición, y una denegación explícita gana siempre.",
  );
  await insertPageNote(
    "Seguridad en AWS",
    "Repasar las políticas de los buckets de S3 y quién puede leer cada uno.",
  );
  await openNotes(page);
  await setTheme(page, "dark");
  await search(page, "politicas");
  await expect(results(page).getByRole("listitem")).toHaveCount(2);
  await afterSaveSettled(page);
  await expectScreenshot(results(page), "notes-search.png", { stylePath: SCREENSHOT_CSS });
});
