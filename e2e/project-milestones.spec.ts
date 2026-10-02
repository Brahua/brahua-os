import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import { afterSaveSettled } from "./support/saves";
import {
  CREATE_AREA,
  insertProject,
  notices,
  openProject,
  uniqueName,
  untilSaved,
} from "./support/projects";

// P3: a project's milestones and progress. Every test works on its own project (inserted in
// "Hobbies" with a unique name), so they run in parallel without a lock. The screenshots of the
// detail and the list (with progress) are in project-detail.spec.ts and projects.spec.ts, over
// the fixtures' milestones.

const THEMES = ["dark", "light"] as const;

const milestoneList = (page: Page) => page.getByRole("list", { name: "Hitos del proyecto" });
const addField = (page: Page) => page.getByRole("textbox", { name: "Nuevo hito" });
const meter = (page: Page) => page.getByRole("meter");
const undo = (page: Page) => notices(page).getByRole("button", { name: "Deshacer" });

/** Titles of the milestones, in the order on screen. */
async function titles(page: Page): Promise<string[]> {
  const labels = await milestoneList(page)
    .getByRole("button", { name: /^Editar hito / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(/^Editar hito /, ""));
}

/** Adds milestones one by one with Enter, each saved before the next. */
async function addMilestones(page: Page, names: string[]) {
  for (const name of names) {
    await addField(page).fill(name);
    await untilSaved(page, () => addField(page).press("Enter"));
    await expect(addField(page)).toHaveValue("");
  }
}

/** dnd-kit loads after the page (the plain list stands in): wait until the handles drag. */
async function sortableReady(page: Page) {
  await expect(
    milestoneList(page)
      .getByRole("button", { name: /^Mover / })
      .first(),
  ).toHaveAttribute("aria-roledescription", "elemento ordenable");
}

/** dnd-kit's live region, which speaks the drag in Spanish. */
const dragStatus = (page: Page) => page.locator('[id^="DndLiveRegion"]');

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

test("add with Enter, check, edit: progress follows, and it all survives a reload", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Taller", testInfo);
  const id = await insertProject({ name });
  await openProject(page, id);
  // No milestones: no progress (never "0 %").
  await expect(page.getByText(/^Sin hitos\./)).toBeVisible();
  await expect(meter(page)).toHaveCount(0);

  await addField(page).focus();
  await addMilestones(page, ["Comprar madera", "Armar la mesa", "Barnizar"]);
  // Enter adds another: the field is still under the cursor.
  await expect(addField(page)).toBeFocused();
  expect(await titles(page)).toEqual(["Comprar madera", "Armar la mesa", "Barnizar"]);
  await expect(meter(page)).toHaveAccessibleName("Avance: 0%, 0 de 3 hitos y tareas");

  // The checkbox and the meter change at once.
  await untilSaved(page, () =>
    page.getByRole("checkbox", { name: "Hecho: Comprar madera" }).check(),
  );
  await expect(meter(page)).toHaveAccessibleName("Avance: 33%, 1 de 3 hitos y tareas");

  // Edit in the row: title and date; Enter saves and focus returns to the title.
  await page.getByRole("button", { name: "Editar hito Barnizar" }).click();
  const title = page.getByRole("textbox", { name: "Título" });
  await expect(title).toBeFocused();
  await title.fill("Barnizar dos manos");
  await page.getByLabel("Fecha", { exact: true }).fill("2030-03-15");
  await untilSaved(page, () => title.press("Enter"));
  const edited = page.getByRole("button", { name: "Editar hito Barnizar dos manos" });
  await expect(edited).toBeFocused();
  await expect(edited).toHaveAccessibleDescription("Para el 15 mar. 2030");

  await page.reload();
  expect(await titles(page)).toEqual(["Comprar madera", "Armar la mesa", "Barnizar dos manos"]);
  await expect(page.getByRole("checkbox", { name: "Hecho: Comprar madera" })).toBeChecked();
  await expect(meter(page)).toHaveAccessibleName("Avance: 33%, 1 de 3 hitos y tareas");

  // The card in the list shows the same progress (and the link is described by it).
  await page.goto(`/projects?area=${CREATE_AREA.slug}`);
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toHaveAccessibleDescription(/Avance: 33%, 1 de 3 hitos y tareas/);
  const card = page.locator("article", { has: link });
  // Drawn, and read once (as the link's description: the meter itself is hidden from AT).
  await expect(card.locator("[data-progress]")).toHaveAttribute("data-progress", "1/3");
});

test("delete from the editor and Deshacer puts it back in its place", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Repisa", testInfo) });
  await openProject(page, id);
  await addField(page).focus();
  await addMilestones(page, ["Medir", "Cortar", "Pintar"]);
  await untilSaved(page, () => page.getByRole("checkbox", { name: "Hecho: Cortar" }).check());

  await page.getByRole("button", { name: "Editar hito Cortar" }).click();
  await untilSaved(page, () => page.getByRole("button", { name: "Eliminar hito" }).click());
  expect(await titles(page)).toEqual(["Medir", "Pintar"]);
  // Focus moves to the next row; the notice offers Deshacer without taking focus.
  await expect(page.getByRole("button", { name: "Editar hito Pintar" })).toBeFocused();
  await expect(notices(page)).toContainText("«Cortar» se eliminó.");
  await expect(meter(page)).toHaveAccessibleName("Avance: 0%, 0 de 2 hitos y tareas");

  await untilSaved(page, () => undo(page).click());
  expect(await titles(page)).toEqual(["Medir", "Cortar", "Pintar"]);
  await expect(notices(page)).toContainText("«Cortar» volvió a su lugar.");

  await page.reload();
  expect(await titles(page)).toEqual(["Medir", "Cortar", "Pintar"]);
  // The same row: still done.
  await expect(page.getByRole("checkbox", { name: "Hecho: Cortar" })).toBeChecked();
});

test("Esc on “Eliminar hito” cancels the editor and leaves the notice alone", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Esc", testInfo) });
  await openProject(page, id);
  await addField(page).focus();
  await addMilestones(page, ["Uno", "Dos"]);
  // A notice on screen: the one a stray Esc would dismiss.
  await untilSaved(page, () => page.getByRole("button", { name: "Bajar Uno" }).click());
  await expect(notices(page)).toContainText("«Uno» pasó al lugar 2 de 2.");

  await page.getByRole("button", { name: "Editar hito Dos" }).click();
  await page.getByRole("button", { name: "Eliminar hito" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Eliminar hito" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar hito Dos" })).toBeFocused();
  await expect(notices(page)).toContainText("«Uno» pasó al lugar 2 de 2.");
  expect(await titles(page)).toEqual(["Dos", "Uno"]);
});

test("reorder with Subir/Bajar: instant, focus stays, saved; Deshacer reverts", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Huerto", testInfo) });
  await openProject(page, id);
  await addField(page).focus();
  await addMilestones(page, ["Uno", "Dos", "Tres"]);

  const up = page.getByRole("button", { name: "Subir Tres" });
  await untilSaved(page, () => up.click());
  expect(await titles(page)).toEqual(["Uno", "Tres", "Dos"]);
  await expect(up).toBeFocused();
  await expect(notices(page)).toContainText("«Tres» pasó al lugar 2 de 3.");
  await expect(undo(page)).not.toBeFocused();
  await untilSaved(page, () => up.click());
  expect(await titles(page)).toEqual(["Tres", "Uno", "Dos"]);
  // At the top the key stays focused and does nothing.
  await expect(up).toHaveAttribute("aria-disabled", "true");
  await expect(up).toBeFocused();

  await page.reload();
  expect(await titles(page)).toEqual(["Tres", "Uno", "Dos"]);

  // Two moves share one notice; Deshacer restores the order before both.
  await page.getByRole("button", { name: "Bajar Tres" }).click();
  await untilSaved(page, () => page.getByRole("button", { name: "Bajar Tres" }).click());
  expect(await titles(page)).toEqual(["Uno", "Dos", "Tres"]);
  await untilSaved(page, () => undo(page).click());
  await expect.poll(() => titles(page)).toEqual(["Tres", "Uno", "Dos"]);
  await expect(notices(page)).toContainText("Volvió el orden anterior de los hitos.");
  await page.reload();
  expect(await titles(page)).toEqual(["Tres", "Uno", "Dos"]);
});

test("reorder by keyboard drag: Space, arrows, Space; Esc cancels; focus stays on the handle", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Bici", testInfo) });
  await openProject(page, id);
  await addField(page).focus();
  await addMilestones(page, ["Frenos", "Cadena", "Llantas"]);
  await sortableReady(page);

  const handle = page.getByRole("button", { name: "Mover Frenos" });
  await expect(handle).toHaveAccessibleDescription(/pulsa Espacio o Enter/);

  async function lift(steps: number) {
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await expect(dragStatus(page)).toContainText("Tomaste «Frenos»");
    // dnd-kit measures the rows right after lifting: keys before that are lost.
    await animationsSettled(page);
    for (let step = 0; step < steps; step++) {
      const before = await dragStatus(page).textContent();
      await page.keyboard.press("ArrowDown");
      await expect(dragStatus(page)).not.toHaveText(before ?? "");
    }
  }

  // Esc cancels: nothing moves, nothing is saved.
  await lift(1);
  await page.keyboard.press("Escape");
  await expect(dragStatus(page)).toContainText("Cancelado. «Frenos» volvió al lugar 1 de 3.");
  expect(await titles(page)).toEqual(["Frenos", "Cadena", "Llantas"]);

  await lift(2);
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expect.poll(() => titles(page)).toEqual(["Cadena", "Llantas", "Frenos"]);
  // Moving down re-inserts the row's node; focus is put back on its handle.
  await expect(handle).toBeFocused();
  await expect(notices(page)).toContainText("«Frenos» pasó al lugar 3 de 3.");

  await page.reload();
  expect(await titles(page)).toEqual(["Cadena", "Llantas", "Frenos"]);
});

test("Mantenimiento keeps the milestones but shows no progress, here or on the card", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Jardín", testInfo);
  const id = await insertProject({ name });
  await openProject(page, id);
  await addField(page).focus();
  await addMilestones(page, ["Podar"]);
  await expect(meter(page)).toHaveAccessibleName("Avance: 0%, 0 de 1 hitos y tareas");

  // Control: the meter is there; switching to Mantenimiento hides it at once.
  await untilSaved(page, () =>
    page
      .getByRole("radiogroup", { name: "Estado" })
      .getByRole("radio", { name: "Mantenimiento" })
      .click(),
  );
  await expect(meter(page)).toHaveCount(0);
  expect(await titles(page)).toEqual(["Podar"]);

  await page.goto(`/projects?area=${CREATE_AREA.slug}`);
  const card = page.locator("article", { has: page.getByRole("link", { name, exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator("[data-progress]")).toHaveCount(0);
  await expect(page.getByRole("link", { name, exact: true })).not.toHaveAccessibleDescription(
    /Avance/,
  );
});

for (const theme of THEMES) {
  test(`axe: milestones, their editor and the notice in the ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const id = await insertProject({ name: uniqueName("Axe", testInfo) });
    await openProject(page, id);
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    // A full load, so the stored theme applies from the first paint.
    await openProject(page, id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await axeViolations(page)).toEqual([]);

    await addField(page).focus();
    await addMilestones(page, ["Primero", "Segundo"]);
    await untilSaved(page, () => page.getByRole("checkbox", { name: "Hecho: Primero" }).check());
    await sortableReady(page);
    expect(await axeViolations(page)).toEqual([]);

    // The editor with an error, then the notice after a move.
    await page.getByRole("button", { name: "Editar hito Segundo" }).click();
    await page.getByRole("textbox", { name: "Título" }).fill("");
    await page.getByRole("textbox", { name: "Título" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "Título" })).toHaveAccessibleDescription(
      "El título es obligatorio.",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("textbox", { name: "Título" }).press("Escape");
    await untilSaved(page, () => page.getByRole("button", { name: "Subir Segundo" }).click());
    await expect(notices(page)).toContainText("«Segundo» pasó al lugar 1 de 2.");
    expect(await axeViolations(page)).toEqual([]);
  });
}
