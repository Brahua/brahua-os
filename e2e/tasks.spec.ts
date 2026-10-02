import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import {
  captureSheet,
  captureStatus,
  captureTitle,
  inbox,
  insertTask,
  openReady,
  readTask,
  readTaskByTitle,
  taskRow,
  uniqueTitle,
} from "./support/tasks";

// T1 of `tasks`: quick capture (the orange key on the phone, C on the desktop), the inbox
// (complete and undo, Clasificar) and the detail. The inbox is shared by tests running in
// parallel: each test works on its own task (a unique title) and never counts the rows.

const THEMES = ["dark", "light"] as const;

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

test("phone: capture from another page in a few taps, then it is in the inbox", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The orange key of the bottom bar");
  const title = uniqueTitle("comprar pilas", testInfo);
  await openReady(page, "/projects");

  // Tap the key, type, Enter: under 10 s (SPEC-tasks), and nothing else is needed.
  const started = Date.now();
  await page.locator(".bo-bottomnav--fixed").getByRole("button", { name: "Capturar" }).click();
  await expect(captureTitle(page)).toBeFocused();
  // Area or project and the date are there from the start (optional).
  await expect(captureSheet(page).getByRole("combobox", { name: "Área o proyecto" })).toBeVisible();
  await expect(captureSheet(page).getByLabel("Fecha límite")).toBeVisible();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  expect(Date.now() - started).toBeLessThan(10_000);
  // Ready for the next one.
  await expect(captureTitle(page)).toHaveValue("");
  await expect(captureTitle(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(captureSheet(page)).toBeHidden();
  // Tareas is under "Más" on the phone since Hábitos took its cell (SPEC-habits).
  await page.locator(".bo-bottomnav--fixed").getByRole("button", { name: "Más" }).click();
  await page
    .getByRole("navigation", { name: "Más secciones" })
    .getByRole("link", { name: "Tareas" })
    .click();
  await expect(page).toHaveURL("/tasks");
  await expect(page).toHaveTitle("Bandeja · Tareas · brahua-os");
  await expect(taskRow(page, title)).toBeVisible();
});

test("desktop: C opens capture anywhere; c typed in the field is text; Enter saves", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Single-key shortcuts act from 1024 px");
  const title = uniqueTitle("llamar a cecilia", testInfo);
  await openReady(page, "/areas");
  await page.keyboard.press("c");
  await expect(captureTitle(page)).toBeFocused();
  // The C hint is on the sidebar's key.
  await page.keyboard.type(title);
  await expect(captureTitle(page)).toHaveValue(title);
  await page.keyboard.press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  await page.keyboard.press("Escape");
  await expect(captureSheet(page)).toBeHidden();

  await page.keyboard.press("3");
  await expect(page).toHaveURL("/tasks");
  await expect(taskRow(page, title)).toBeVisible();
});

test("capture into an area: it goes there, not to the inbox", async ({ page }, testInfo) => {
  const title = uniqueTitle("pedir cita", testInfo);
  await openReady(page, "/tasks");
  await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
  const placement = captureSheet(page).getByRole("combobox", { name: "Área o proyecto" });
  await expect(placement.getByRole("option", { name: "Trabajo", exact: true })).toBeAttached();
  await placement.selectOption({ label: "Trabajo" });
  await captureTitle(page).fill(title);
  await captureTitle(page).press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a «Trabajo».");
  await page.keyboard.press("Escape");
  // Positive: it is stored in Trabajo (not only absent from the inbox).
  expect(await readTaskByTitle(title)).toMatchObject({ areaSlug: "work", doneAt: null });
  await page.reload();
  await expect(inbox(page).getByRole("link", { name: title })).toHaveCount(0);
});

test("complete with one tap, Deshacer brings it back, and both survive a reload", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("regar plantas", testInfo);
  const id = await insertTask({ title, due: -2, priority: "high" });
  await openReady(page, "/tasks");
  const row = taskRow(page, title);
  await expect(row.getByRole("link", { name: title })).toHaveAccessibleDescription(
    "Retrasada hace 2 días, Prioridad alta",
  );

  await untilSaved(page, () => row.getByRole("checkbox", { name: `Hecha: ${title}` }).click());
  await expect(row).toHaveCount(0);
  await expect(notices(page).getByText(`«${title}» está hecha.`)).toBeVisible();
  expect((await readTask(id)).doneAt).not.toBeNull();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(row).toBeVisible();
  expect((await readTask(id)).doneAt).toBeNull();
  await page.reload();
  await expect(taskRow(page, title)).toBeVisible();
});

test("Clasificar: assign an area and a date; Deshacer puts it back in the inbox", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("pintar la reja", testInfo);
  const id = await insertTask({ title });
  await openReady(page, "/tasks");
  await taskRow(page, title)
    .getByRole("button", { name: `Clasificar «${title}»` })
    .click();
  const sheet = page.getByRole("dialog", { name: "Clasificar tarea" });
  await sheet.getByRole("combobox", { name: "Área o proyecto" }).selectOption({ label: "Hogar" });
  await sheet.getByLabel("Fecha límite").fill("2030-05-01");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(taskRow(page, title)).toHaveCount(0);
  await expect(notices(page).getByText(`«${title}» pasó a «Hogar».`)).toBeVisible();
  expect(await readTask(id)).toMatchObject({ areaSlug: "home", dueDate: "2030-05-01" });

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(taskRow(page, title)).toBeVisible();
  expect(await readTask(id)).toMatchObject({ areaSlug: null, dueDate: null });
});

test("the detail: a side sheet on the desktop, its page on the phone; edits and delete", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("devolver libro", testInfo);
  const id = await insertTask({ title });
  await openReady(page, "/tasks");
  await taskRow(page, title).getByRole("link", { name: title }).click();
  const desktop = isDesktop(testInfo);
  const scope = desktop ? page.getByRole("dialog", { name: title }) : page.locator("main");
  if (desktop) {
    await expect(scope).toBeVisible();
    await expect(page).toHaveURL("/tasks");
  } else {
    await expect(page).toHaveURL(`/tasks/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(`${title} · brahua-os`);
  }

  await untilSaved(page, () => scope.getByRole("radio", { name: "Alta" }).click());
  await expect(scope.getByRole("radio", { name: "Alta" })).toHaveAttribute("aria-checked", "true");
  // Polled: the detail's own reads (notes, milestones) are Server Actions too, so the response
  // `untilSaved` saw may not be the priority's (it failed that way once in a full local run).
  await expect.poll(async () => (await readTask(id)).priority).toBe("high");

  await untilSaved(page, () => scope.getByRole("button", { name: "Eliminar tarea" }).click());
  await expect(notices(page).getByText(`«${title}» se eliminó.`)).toBeVisible();
  await expect(page).toHaveURL("/tasks");
  await expect(taskRow(page, title)).toHaveCount(0);
  expect((await readTask(id)).deletedAt).not.toBeNull();
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(taskRow(page, title)).toBeVisible();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (inbox, Clasificar, capture, detail)`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const title = uniqueTitle("revisar axe", testInfo);
    await insertTask({ title, due: 0, priority: "high" });
    await openReady(page, "/tasks");
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);

    await taskRow(page, title)
      .getByRole("button", { name: `Clasificar «${title}»` })
      .click();
    await expect(page.getByRole("dialog", { name: "Clasificar tarea" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
    await expect(captureTitle(page)).toBeFocused();
    await captureSheet(page).getByRole("button", { name: "Más detalles" }).click();
    // An error on the title too.
    await captureTitle(page).press("Enter");
    await expect(captureTitle(page)).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/tasks?vista=hoy");
    expect(await axeViolations(page)).toEqual([]);

    await page.goto("/tasks");
    await taskRow(page, title).getByRole("link", { name: title }).click();
    if (isDesktop(testInfo)) {
      await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    }
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the quick capture sheet (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReady(page, "/");
    await setTheme(page, theme);
    await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
    await expect(captureTitle(page)).toBeFocused();
    // The areas loaded (the closed picker shows "Bandeja" either way).
    await expect(
      captureSheet(page).getByRole("combobox", { name: "Área o proyecto" }).getByRole("option", {
        name: "Salud",
      }),
    ).toBeAttached();
    await animationsSettled(page);
    await expectScreenshot(captureSheet(page), `quick-capture-${theme}.png`);
  });
}

test("unknown or deleted task pages are a 404 inside the shell", async ({ page }) => {
  const response = await page.goto("/tasks/00000000-0000-4000-8000-000000000000");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Tarea no encontrada · brahua-os");
  await expect(page.getByRole("heading", { level: 1, name: "Esta tarea no existe" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver a Tareas" })).toHaveAttribute(
    "href",
    "/tasks",
  );
});

test("at 320 px the inbox and the views don't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const title = uniqueTitle("un título bastante largo para una pantalla angosta", testInfo);
  await insertTask({ title, due: -3, priority: "high" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/tasks");
  await expect(taskRow(page, title)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
