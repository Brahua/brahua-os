import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createDb } from "@/lib/db";
import { projectDependencies } from "@/modules/projects/db/schema";
import { testDatabaseUrl } from "../tests/integration/helpers";
import { animationsSettled } from "./support/animations";
import {
  CREATE_AREA,
  groupList,
  insertProject,
  notices,
  openProject,
  openProjects,
  uniqueName,
  untilSaved,
} from "./support/projects";

// P4: "Bloqueado por". Every test works on its own projects (in "Hobbies", unique names), so they
// run in parallel without a lock; no screenshot here (the detail's references show the empty
// section of DETAIL_FIXTURE).

const THEMES = ["dark", "light"] as const;

/** `projectId` blocked by `blockedById`, straight in the database (another tab, in effect). */
async function insertDependency(projectId: string, blockedById: string) {
  const db = createDb(testDatabaseUrl());
  try {
    await db.insert(projectDependencies).values({ projectId, blockedById });
  } finally {
    await db.$client.end();
  }
}

async function axeViolations(page: Page) {
  await animationsSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const section = (page: Page) => page.getByRole("region", { name: "Bloqueado por" });
const blockers = (page: Page) =>
  section(page).getByRole("list", { name: "Proyectos que lo bloquean" });
const headerLine = (page: Page) => page.locator("main header [data-blocked-by]");
const addKey = (page: Page) => page.getByRole("button", { name: "Agregar bloqueador" });
const picker = (page: Page) => page.getByRole("dialog", { name: "Agregar bloqueador" });
const search = (page: Page) => picker(page).getByRole("searchbox", { name: "Buscar proyecto" });
const statusGroup = (page: Page) => page.getByRole("radiogroup", { name: "Estado" });

/** The card of `name` in the list of "Hobbies", where the tests' projects live. */
async function cardOf(page: Page, name: string) {
  await openProjects(page, `?area=${CREATE_AREA.slug}`);
  return groupList(page, "Activo").locator("article", { has: page.getByRole("link", { name }) });
}

/** Opens the picker and narrows it to `name` (the database has every other test's projects). */
async function findCandidate(page: Page, name: string) {
  await addKey(page).click();
  await expect(search(page)).toBeFocused();
  await search(page).fill(name);
  return picker(page).getByRole("button", { name: new RegExp(`^${name}`) });
}

test("a blocker shows Bloqueado on the card and the detail, and clears once it is Terminado", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Mudanza", testInfo);
  const blockerName = uniqueName("Permiso", testInfo);
  const id = await insertProject({ name });
  const blockerId = await insertProject({ name: blockerName });

  await openProject(page, id);
  await expect(section(page)).toContainText("No espera a ningún otro proyecto.");
  await expect(headerLine(page)).toHaveCount(0);

  const option = await findCandidate(page, blockerName);
  await untilSaved(page, () => option.click());
  await expect(picker(page)).toBeHidden();
  await expect(addKey(page)).toBeFocused();
  await expect(blockers(page).getByRole("link", { name: blockerName })).toBeVisible();
  await expect(headerLine(page)).toHaveText(`Bloqueado por ${blockerName}`);
  await expect(headerLine(page).getByRole("link", { name: blockerName })).toHaveAttribute(
    "href",
    `/projects/${blockerId}`,
  );

  // The list: "Bloqueado", and the card's link says by whom.
  let card = await cardOf(page, name);
  await expect(card.getByText("Bloqueado", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name })).toHaveAccessibleDescription(
    `Bloqueado por ${blockerName}`,
  );

  // The blocker ends: nothing is blocked any more.
  await openProject(page, blockerId);
  await untilSaved(page, () => statusGroup(page).getByRole("radio", { name: "Terminado" }).click());

  await openProject(page, id);
  await expect(headerLine(page)).toHaveCount(0);
  await expect(blockers(page).getByRole("listitem")).toContainText("Ya no bloquea");
  card = await cardOf(page, name);
  // Positive control: the card is there, only without the badge.
  await expect(card).toBeVisible();
  await expect(card.locator("[data-blocked]")).toHaveCount(0);
});

test("a cycle made meanwhile is refused with an error on the search field", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Cocina", testInfo);
  const otherName = uniqueName("Muebles", testInfo);
  const id = await insertProject({ name });
  const otherId = await insertProject({ name: otherName });

  await openProject(page, id);
  const option = await findCandidate(page, otherName);
  // Offered: nothing links them yet.
  await expect(option).toBeVisible();

  // Meanwhile (another tab), the other project starts waiting for this one.
  await insertDependency(otherId, id);
  await untilSaved(page, () => option.click());

  await expect(search(page)).toHaveAttribute("aria-invalid", "true");
  await expect(search(page)).toHaveAccessibleDescription(
    "Ese proyecto ya depende de este (directa o indirectamente): agregarlo crearía un ciclo. Elige otro.",
  );
  await expect(search(page)).toBeFocused();
  await expect(picker(page)).toBeVisible();

  // After the refusal the page caught up: it is no longer offered.
  await page.keyboard.press("Escape");
  await expect(picker(page)).toBeHidden();
  await addKey(page).click();
  await search(page).fill(otherName);
  await expect(picker(page)).toContainText("Ningún proyecto coincide con la búsqueda.");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(blockers(page)).toHaveCount(0);
});

test("remove a blocker, then Deshacer brings it back", async ({ page }, testInfo) => {
  const name = uniqueName("Jardín", testInfo);
  const blockerName = uniqueName("Riego", testInfo);
  const id = await insertProject({ name });
  const blockerId = await insertProject({ name: blockerName });
  await insertDependency(id, blockerId);

  await openProject(page, id);
  await expect(headerLine(page)).toHaveText(`Bloqueado por ${blockerName}`);
  await untilSaved(page, () =>
    page.getByRole("button", { name: `Quitar «${blockerName}»` }).click(),
  );
  await expect(notices(page)).toContainText(`«${blockerName}» ya no bloquea este proyecto.`);
  await expect(blockers(page)).toHaveCount(0);
  await expect(headerLine(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toBeFocused();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(notices(page)).toContainText(`«${blockerName}» vuelve a bloquear este proyecto.`);
  await expect(blockers(page).getByRole("link", { name: blockerName })).toBeVisible();
  await expect(headerLine(page)).toHaveText(`Bloqueado por ${blockerName}`);

  await page.reload();
  await expect(blockers(page).getByRole("link", { name: blockerName })).toBeVisible();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with blockers, the picker and its error`, async ({
    page,
  }, testInfo) => {
    const name = uniqueName("Taller", testInfo);
    const openName = uniqueName("Herramientas", testInfo);
    const doneName = uniqueName("Planos", testInfo);
    const id = await insertProject({ name });
    await insertDependency(id, await insertProject({ name: openName }));
    await insertDependency(id, await insertProject({ name: doneName, status: "done" }));

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/projects");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await openProject(page, id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(headerLine(page)).toHaveText(`Bloqueado por ${openName}`);
    expect(await axeViolations(page)).toEqual([]);

    // The card with its badge.
    const card = await cardOf(page, name);
    await expect(card.locator("[data-blocked]")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // The picker, filtered, then with the error of a cycle.
    await openProject(page, id);
    const other = uniqueName("Ciclo", testInfo);
    const otherId = await insertProject({ name: other });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    const option = await findCandidate(page, other);
    expect(await axeViolations(page)).toEqual([]);
    await insertDependency(otherId, id);
    await untilSaved(page, () => option.click());
    await expect(search(page)).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(addKey(page)).toBeFocused();
  });
}
