import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { openReady, uniqueTitle } from "./support/tasks";
import {
  insertProjectWithMilestones,
  insertViewTask,
  ownTitles,
  readViewTask,
  viewList,
  viewRow,
  VIEWS_FIXTURE,
} from "./support/task-views";
import { upcomingDayLabel } from "@/modules/tasks/task-views";

// T2 of `tasks`: the views Hoy, Próximas, Todas (filters in the URL) and Hechas, and the detail's
// Notas and Hito. The database is shared by tests running in parallel: each test works on its
// own tasks (unique titles) and only looks at those; the fixture project (VIEWS_FIXTURE) is read
// only.

const THEMES = ["dark", "light"] as const;
const FIXTURE_ONLY_CSS = path.join(__dirname, "support/task-views-only.css");

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

test("Hoy: overdue and due today, the oldest first, then priority; not tomorrow or done", async ({
  page,
}, testInfo) => {
  const late = uniqueTitle("pagar luz", testInfo);
  const todayHigh = uniqueTitle("regar plantas", testInfo);
  const todayMedium = uniqueTitle("comprar pan", testInfo);
  const tomorrow = uniqueTitle("llamar a mamá", testInfo);
  const done = uniqueTitle("sacar basura", testInfo);
  await insertViewTask({ title: todayMedium, due: 0 });
  await insertViewTask({ title: tomorrow, due: 1 });
  await insertViewTask({ title: todayHigh, due: 0, priority: "high" });
  await insertViewTask({ title: late, due: -3, priority: "low" });
  await insertViewTask({ title: done, due: 0, doneHoursAgo: 1 });

  await openReady(page, "/tasks?vista=hoy");
  await expect(page).toHaveTitle("Hoy · Tareas · brahua-os");
  const views = page.getByRole("navigation", { name: "Vistas de tareas" });
  await expect(views.getByRole("link", { name: "Hoy", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const mine = [late, todayHigh, todayMedium, tomorrow, done];
  await expect(viewRow(page, todayMedium)).toBeVisible();
  expect(await ownTitles(page, "Tareas de hoy", mine)).toEqual([late, todayHigh, todayMedium]);
  await expect(page.getByRole("heading", { level: 2, name: /^Hoy: \d+ tareas?$/ })).toBeVisible();

  // Completing one takes it out of Hoy (and Deshacer brings it back).
  await untilSaved(page, () =>
    viewRow(page, todayMedium).getByRole("checkbox", { name: `Hecha: ${todayMedium}` }).click(),
  );
  await expect(viewRow(page, todayMedium)).toHaveCount(0);
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(viewRow(page, todayMedium)).toBeVisible();
});

test("Próximas: the next 7 days without today, grouped by day", async ({ page }, testInfo) => {
  const today = uniqueTitle("hoy no", testInfo);
  const tomorrow = uniqueTitle("comprar regalo", testInfo);
  const inThree = uniqueTitle("pagar tarjeta", testInfo);
  const later = uniqueTitle("muy lejos", testInfo);
  await insertViewTask({ title: today, due: 0 });
  await insertViewTask({ title: tomorrow, due: 1 });
  await insertViewTask({ title: inThree, due: 3 });
  await insertViewTask({ title: later, due: 8 });

  await openReady(page, "/tasks?vista=proximas");
  await expect(page).toHaveTitle("Próximas · Tareas · brahua-os");
  await expect(viewList(page, "Mañana").getByRole("link", { name: tomorrow })).toBeVisible();
  const dayThree = upcomingDayLabel(limaDay(3), new Date());
  await expect(page.getByRole("heading", { level: 3, name: dayThree })).toBeVisible();
  await expect(viewList(page, dayThree).getByRole("link", { name: inThree })).toBeVisible();
  // Positive control above; today and later are not here.
  await expect(viewRow(page, today)).toHaveCount(0);
  await expect(viewRow(page, later)).toHaveCount(0);
});

test("Todas: filters by project and area live in the URL and survive a reload", async ({
  page,
}) => {
  await openReady(page, "/tasks?vista=todas");
  const filters = page.getByRole("group", { name: "Filtros" });
  await filters.getByRole("button", { name: "Filtrar por proyecto: Todos" }).click();
  const sheet = page.getByRole("dialog", { name: "Filtrar por proyecto" });
  await sheet.getByRole("link", { name: new RegExp(`^${VIEWS_FIXTURE.name}`) }).click();
  await expect(page).toHaveURL(`/tasks?vista=todas&proyecto=${VIEWS_FIXTURE.projectId}`);
  await expect(sheet).toBeHidden();
  const fixtureTitles = VIEWS_FIXTURE.tasks.map((task) => task.title);
  // By date (undated last); every row is the project's.
  await expect(viewList(page, "Tareas pendientes").getByRole("link")).toHaveText(fixtureTitles);
  await expect(
    filters.getByRole("button", { name: `Filtrar por proyecto: ${VIEWS_FIXTURE.name}` }),
  ).toBeFocused();

  await page.reload();
  await expect(viewList(page, "Tareas pendientes").getByRole("link")).toHaveText(fixtureTitles);

  // An area: the project stays only if it is of that area (Mudanza is in Trabajo).
  await filters.getByRole("button", { name: "Filtrar por área: Todas" }).click();
  await page
    .getByRole("dialog", { name: "Filtrar por área" })
    .getByRole("link", { name: "Trabajo" })
    .click();
  await expect(page).toHaveURL(
    `/tasks?vista=todas&area=work&proyecto=${VIEWS_FIXTURE.projectId}`,
  );
  await filters.getByRole("button", { name: "Filtrar por área: Trabajo" }).click();
  await page
    .getByRole("dialog", { name: "Filtrar por área" })
    .getByRole("link", { name: "Hogar" })
    .click();
  await expect(page).toHaveURL("/tasks?vista=todas&area=home");
  await expect(viewRow(page, fixtureTitles[0])).toHaveCount(0);
});

test("Hechas: done in the last 30 days; Deshacer reopens it, and the notice undoes that", async ({
  page,
}, testInfo) => {
  const recent = uniqueTitle("lavar ropa", testInfo);
  const old = uniqueTitle("hace mucho", testInfo);
  const id = await insertViewTask({ title: recent, doneHoursAgo: 1 });
  await insertViewTask({ title: old, doneHoursAgo: 31 * 24 });

  await openReady(page, "/tasks?vista=hechas");
  await expect(page).toHaveTitle("Hechas · Tareas · brahua-os");
  const row = viewRow(page, recent);
  await expect(row.getByRole("checkbox", { name: `Hecha: ${recent}` })).toBeChecked();
  await expect(viewRow(page, old)).toHaveCount(0);

  await untilSaved(page, () =>
    row.getByRole("button", { name: `Deshacer «${recent}» (vuelve a pendientes)` }).click(),
  );
  await expect(row).toHaveCount(0);
  await expect(notices(page).getByText(`«${recent}» volvió a estar pendiente.`)).toBeVisible();
  expect((await readViewTask(id)).doneAt).toBeNull();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(viewRow(page, recent)).toBeVisible();
  expect((await readViewTask(id)).doneAt).not.toBeNull();
});

/** Opens a task's detail: the sheet on the desktop, its page on the phone. */
async function openDetail(page: Page, title: string, desktop: boolean) {
  await viewRow(page, title).getByRole("link", { name: title }).click();
  if (desktop) {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.locator("main");
}

test("Notas: write, preview and save Markdown; it is there after reopening", async ({
  page,
}, testInfo) => {
  const desktop = isDesktop(testInfo);
  const title = uniqueTitle("plan de riego", testInfo);
  const id = await insertViewTask({ title, due: 0 });
  await openReady(page, "/tasks?vista=hoy");
  const scope = await openDetail(page, title, desktop);
  const notes = scope.getByRole("region", { name: "Notas" });
  await notes.getByRole("button", { name: "Escribir notas" }).click();
  const text = notes.getByRole("textbox", { name: "Notas en Markdown" });
  await text.fill("## Riego\n\nCada **tres** días.");
  await notes.getByRole("tab", { name: "Vista previa" }).click();
  await expect(notes.getByRole("heading", { name: "Riego" })).toBeVisible();
  await untilSaved(page, () => notes.getByRole("button", { name: "Guardar" }).click());
  await expect(notes.getByText("tres")).toHaveJSProperty("tagName", "STRONG");
  await expect.poll(async () => (await readViewTask(id)).notes).toBe("## Riego\n\nCada **tres** días.");

  if (desktop) {
    await page.keyboard.press("Escape");
    await expect(scope).toBeHidden();
    const again = await openDetail(page, title, desktop);
    await expect(again.getByRole("region", { name: "Notas" }).getByText("tres")).toBeVisible();
  } else {
    await page.reload();
    await expect(page.getByRole("region", { name: "Notas" }).getByText("tres")).toBeVisible();
  }
});

test("Notas: unsaved changes ask before leaving", async ({ page }, testInfo) => {
  const desktop = isDesktop(testInfo);
  const title = uniqueTitle("borrador", testInfo);
  await insertViewTask({ title, due: 0 });
  await openReady(page, "/tasks?vista=hoy");
  const scope = await openDetail(page, title, desktop);
  const notes = scope.getByRole("region", { name: "Notas" });
  await notes.getByRole("button", { name: "Escribir notas" }).click();
  await notes.getByRole("textbox", { name: "Notas en Markdown" }).fill("sin guardar");
  if (desktop) {
    // Closing the sheet asks inside it.
    await page.keyboard.press("Escape");
    await expect(scope).toBeVisible();
  } else {
    await page.getByRole("link", { name: "Volver a Tareas" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  }
  const confirm = scope.getByRole("group", { name: "Tienes cambios sin guardar en las notas." });
  await expect(confirm.getByRole("button", { name: "Seguir editando" })).toBeFocused();
  await confirm.getByRole("button", { name: "Salir sin guardar" }).click();
  if (desktop) await expect(scope).toBeHidden();
  else await expect(page).toHaveURL("/tasks");
});

test("Hito: only with a project; pick one of its milestones, then none", async ({
  page,
}, testInfo) => {
  const desktop = isDesktop(testInfo);
  const title = uniqueTitle("comprar pintura", testInfo);
  const project = await insertProjectWithMilestones(uniqueTitle("Taller", testInfo), [
    "Planos",
    "Pintura",
  ]);
  const id = await insertViewTask({ title, due: 0, projectId: project.id });
  await openReady(page, "/tasks?vista=hoy");
  const scope = await openDetail(page, title, desktop);
  const milestone = scope.getByRole("combobox", { name: "Hito" });
  await expect(milestone.getByRole("option", { name: "Pintura" })).toBeAttached();
  await untilSaved(page, () => milestone.selectOption({ label: "Pintura" }));
  await expect.poll(async () => (await readViewTask(id)).milestoneId).toBe(project.milestones[1]);
  await untilSaved(page, () => milestone.selectOption({ label: "Sin hito" }));
  await expect.poll(async () => (await readViewTask(id)).milestoneId).toBeNull();
  // Positive and negative: a task without a project has no milestone field.
  const loose = uniqueTitle("sin proyecto", testInfo);
  await insertViewTask({ title: loose, due: 0 });
  if (desktop) {
    await page.keyboard.press("Escape");
    await expect(scope).toBeHidden();
  }
  await page.goto("/tasks?vista=hoy");
  const other = await openDetail(page, loose, desktop);
  await expect(other.getByRole("region", { name: "Notas" })).toBeVisible();
  await expect(other.getByRole("combobox", { name: "Hito" })).toHaveCount(0);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations in the views and the detail`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const desktop = isDesktop(testInfo);
    const title = uniqueTitle("revisar axe vistas", testInfo);
    await insertViewTask({ title, due: 0 });
    await insertViewTask({ title: uniqueTitle("hecha axe", testInfo), doneHoursAgo: 2 });
    await insertViewTask({ title: uniqueTitle("mañana axe", testInfo), due: 1 });
    await openReady(page, "/tasks?vista=hoy");
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);

    for (const view of ["proximas", "hechas"]) {
      await page.goto(`/tasks?vista=${view}`);
      expect(await axeViolations(page)).toEqual([]);
    }

    await page.goto(`/tasks?vista=todas&proyecto=${VIEWS_FIXTURE.projectId}`);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: /^Filtrar por proyecto/ }).click();
    await expect(page.getByRole("dialog", { name: "Filtrar por proyecto" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    // The detail with the notes editor (preview) and the milestone field.
    await page.goto("/tasks?vista=hoy");
    const fixtureTask = VIEWS_FIXTURE.tasks[0].title;
    const scope = await openDetail(page, fixtureTask, desktop);
    await expect(scope.getByRole("combobox", { name: "Hito" })).toBeVisible();
    const notes = scope.getByRole("region", { name: "Notas" });
    await notes.getByRole("button", { name: "Escribir notas" }).click();
    await notes.getByRole("textbox", { name: "Notas en Markdown" }).fill("# Título\n\n- uno");
    await notes.getByRole("tab", { name: "Vista previa" }).click();
    await expect(notes.getByRole("heading", { name: "Título" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // Leave the fixture's notes as they were (never saved).
    await notes.getByRole("tab", { name: "Escribir" }).click();
    await notes.getByRole("button", { name: "Cancelar" }).click();
  });

  test(`${theme} theme: Hoy and Todas (reference screenshots)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReady(page, "/tasks?vista=hoy");
    await setTheme(page, theme);
    const today = viewList(page, "Tareas de hoy");
    await expect(today.getByRole("link", { name: VIEWS_FIXTURE.tasks[1].title })).toBeVisible();
    await afterSaveSettled(page);
    await expectScreenshot(today, `tasks-today-${theme}.png`, { stylePath: FIXTURE_ONLY_CSS });

    await page.goto(`/tasks?vista=todas&proyecto=${VIEWS_FIXTURE.projectId}`);
    await expect(viewList(page, "Tareas pendientes").getByRole("link")).toHaveCount(
      VIEWS_FIXTURE.tasks.length,
    );
    await afterSaveSettled(page);
    await expectScreenshot(
      page.locator('section[aria-labelledby="tasks-view-title"]'),
      `tasks-all-${theme}.png`,
    );
  });
}
