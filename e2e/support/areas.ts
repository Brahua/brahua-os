// Shared helpers for the life areas specs (areas.spec.ts, areas-order.spec.ts).
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

export const SEEDED = [
  "Hogar",
  "Salud y Bienestar",
  "Finanzas e Inversiones",
  "Aprendizaje y Desarrollo profesional",
  "Trabajo",
  "Relaciones y Familia",
  "Planes y Viajes",
  "Hobbies",
];

export const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";
export const list = (page: Page) => page.getByRole("list", { name: "Tus áreas" });
export const editRows = (page: Page) => list(page).getByRole("button", { name: /^Editar / });
export const newAreaButton = (page: Page) => page.getByRole("button", { name: "Nueva área" });
export const sheet = (page: Page) => page.getByRole("dialog");
export const nameField = (page: Page) => sheet(page).getByRole("textbox", { name: "Nombre" });
export const colorGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Color" });
export const iconGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Ícono" });
export const notices = (page: Page) => page.getByRole("status", { name: "Avisos" });
export const archivedToggle = (page: Page) => page.getByRole("button", { name: /^Archivadas/ });
export const archivedList = (page: Page) => page.getByRole("list", { name: "Áreas archivadas" });

/** A name no other test (or retry) uses. */
export function uniqueName(prefix: string, testInfo: TestInfo) {
  return `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;
}

/** Names of the active areas, in the order on screen. */
export async function rowNames(page: Page): Promise<string[]> {
  const labels = await editRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("aria-label") ?? ""),
  );
  return labels.map((label) => label.replace(/^Editar /, ""));
}

/** Position of the area's row in the list (-1 if it is not there). */
export async function rowIndex(page: Page, name: string) {
  return (await rowNames(page)).indexOf(name);
}

export async function openAreas(page: Page) {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Áreas" })).toBeVisible();
}

export async function createArea(page: Page, name: string, color: string, icon: string) {
  await newAreaButton(page).click();
  await nameField(page).fill(name);
  await colorGroup(page).getByRole("radio", { name: color }).click();
  await iconGroup(page).getByRole("radio", { name: icon }).click();
  await sheet(page).getByRole("button", { name: "Crear área" }).click();
  await expect(sheet(page)).toBeHidden();
}

export const test = base;

/**
 * `test` for tests that change the set of active areas (create, archive, unarchive) or
 * reorder. The E2E database is shared by every worker, and a reorder sends the whole list of
 * active areas, which the server rejects if that set changed meanwhile (by design). So these
 * tests hold a Postgres advisory lock, on a connection of their own, for the whole test.
 * Read-only tests use plain `test`.
 */
export const testWithAreasLock = base.extend<{ areasLock: void }>({
  areasLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide) => {
      const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await client.connect();
      await client.query("select pg_advisory_lock(hashtext('e2e_life_areas'))");
      // Fixture teardown runs after a failed test too; ending the session releases the lock.
      await provide();
      await client.end();
    },
    // Every test of this kind takes it; waiting for it is not the test's time.
    { auto: true, timeout: 240_000 },
  ],
});

export { expect };
