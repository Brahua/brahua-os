import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";

// Shared database: global-setup seeds the 8 default areas, and other tests here create more in
// parallel. Each test uses its own names and never edits the seeded areas, which the
// screenshots show.

const THEMES = ["dark", "light"] as const;
const SEEDED = [
  "Hogar",
  "Salud y Bienestar",
  "Finanzas e Inversiones",
  "Aprendizaje y Desarrollo profesional",
  "Trabajo",
  "Relaciones y Familia",
  "Planes y Viajes",
  "Hobbies",
];
const SCREENSHOT_CSS = [
  path.join(__dirname, "support/hide-app-nav.css"),
  path.join(__dirname, "support/seeded-areas-only.css"),
];

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";
const list = (page: Page) => page.getByRole("list", { name: "Tus áreas" });
const newAreaButton = (page: Page) => page.getByRole("button", { name: "Nueva área" });
const sheet = (page: Page) => page.getByRole("dialog");
const nameField = (page: Page) => sheet(page).getByRole("textbox", { name: "Nombre" });
const colorGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Color" });
const iconGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Ícono" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /./ });

/** A name no other test (or retry) uses. */
function uniqueName(prefix: string, testInfo: TestInfo) {
  return `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;
}

async function openAreas(page: Page) {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Áreas" })).toBeVisible();
}

async function createArea(page: Page, name: string, color: string, icon: string) {
  await newAreaButton(page).click();
  await nameField(page).fill(name);
  await colorGroup(page).getByRole("radio", { name: color }).click();
  await iconGroup(page).getByRole("radio", { name: icon }).click();
  await sheet(page).getByRole("button", { name: "Crear área" }).click();
  await expect(sheet(page)).toBeHidden();
}

test("Áreas has its title, is in the navigation and lists the seeded areas in order", async ({
  page,
}) => {
  await openAreas(page);
  await expect(page).toHaveTitle("Áreas · brahua-os");
  await expect(page.getByRole("link", { name: "Áreas" })).toHaveAttribute("aria-current", "page");

  const rows = list(page).getByRole("button");
  await expect(rows.first()).toHaveAccessibleName("Editar Hogar");
  const names = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label")),
  );
  expect(names.slice(0, 8)).toEqual(SEEDED.map((name) => `Editar ${name}`));
});

test("7 goes to Áreas (desktop)", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await page.keyboard.press("7");
  await expect(page).toHaveURL("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Áreas" })).toBeVisible();
});

test("create an area: side panel on desktop, bottom sheet on the phone", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Música", testInfo);
  await openAreas(page);
  await newAreaButton(page).click();

  await expect(sheet(page)).toHaveAccessibleName("Nueva área");
  await expect(sheet(page)).toHaveClass(
    isDesktop(testInfo) ? /bo-sheet--side/ : /bo-sheet--bottom/,
  );
  await expect(nameField(page)).toBeFocused();

  await nameField(page).fill(name);
  await colorGroup(page).getByRole("radio", { name: "Lima" }).click();
  await iconGroup(page).getByRole("radio", { name: "Música" }).click();
  // Live preview.
  const preview = sheet(page).locator(".bo-area-tag");
  await expect(preview).toHaveText(name);
  await expect(preview).toHaveClass(/bo-area--hobbies/);

  await sheet(page).getByRole("button", { name: "Crear área" }).click();

  await expect(sheet(page)).toBeHidden();
  await expect(newAreaButton(page)).toBeFocused();
  await expect(status(page)).toHaveText(`Área «${name}» creada.`);
  // At the end of the list, and still there after a reload.
  await expect(list(page).getByRole("button").last()).toHaveAccessibleName(`Editar ${name}`);
  await page.reload();
  await expect(list(page).getByRole("button", { name: `Editar ${name}` })).toBeVisible();
});

test("edit an area: the row keeps its place and gets focus back", async ({ page }, testInfo) => {
  const name = uniqueName("Lectura", testInfo);
  const renamed = uniqueName("Libros", testInfo);
  await openAreas(page);
  await createArea(page, name, "Índigo", "Libro abierto");

  const row = list(page).getByRole("button", { name: `Editar ${name}` });
  await row.click();
  await expect(sheet(page)).toHaveAccessibleName("Editar área");
  await expect(nameField(page)).toHaveValue(name);
  await expect(colorGroup(page).getByRole("radio", { name: "Índigo" })).toBeChecked();
  await expect(iconGroup(page).getByRole("radio", { name: "Libro abierto" })).toBeChecked();

  await nameField(page).fill(renamed);
  await colorGroup(page).getByRole("radio", { name: "Rosa" }).click();
  await sheet(page).getByRole("button", { name: "Guardar cambios" }).click();

  await expect(sheet(page)).toBeHidden();
  const renamedRow = list(page).getByRole("button", { name: `Editar ${renamed}` });
  await expect(renamedRow).toBeFocused();
  await expect(renamedRow.locator(".bo-area-tag")).toHaveClass(/bo-area--relationships/);
  await expect(list(page).getByRole("button", { name: `Editar ${name}` })).toHaveCount(0);
  await expect(status(page)).toHaveText(`Cambios guardados en «${renamed}».`);
});

test("validation errors show on each field", async ({ page }) => {
  await openAreas(page);
  await newAreaButton(page).click();
  await sheet(page).getByRole("button", { name: "Crear área" }).click();

  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(nameField(page)).toHaveAccessibleDescription("El nombre es obligatorio.");
  await expect(nameField(page)).toBeFocused();
  await expect(colorGroup(page)).toHaveAttribute("aria-invalid", "true");
  await expect(colorGroup(page)).toHaveAccessibleDescription("Elige un color.");
  await expect(iconGroup(page)).toHaveAttribute("aria-invalid", "true");
  await expect(iconGroup(page)).toHaveAccessibleDescription("Elige un ícono.");
  await expect(sheet(page)).toBeVisible();

  await nameField(page).fill("a".repeat(61));
  await colorGroup(page).getByRole("radio", { name: "Verde" }).click();
  await iconGroup(page).getByRole("radio", { name: "Hoja" }).click();
  await sheet(page).getByRole("button", { name: "Crear área" }).click();
  await expect(nameField(page)).toHaveAccessibleDescription("Usa 60 caracteres como máximo.");
  await expect(colorGroup(page)).not.toHaveAttribute("aria-invalid");
  await expect(iconGroup(page)).not.toHaveAttribute("aria-invalid");
  await expect(list(page).getByRole("button", { name: `Editar ${"a".repeat(61)}` })).toHaveCount(0);
});

test("keyboard only: open, fill, pick swatch and icon with arrows, save, Esc", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Jardín", testInfo);
  await openAreas(page);
  await newAreaButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type(name);

  // Name → the color group (one tab stop; nothing picked yet, so the first swatch).
  await page.keyboard.press("Tab");
  await expect(colorGroup(page).getByRole("radio", { name: "Ámbar" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(colorGroup(page).getByRole("radio", { name: "Verde" })).toBeFocused();
  await expect(colorGroup(page).getByRole("radio", { name: "Verde" })).toBeChecked();
  await page.keyboard.press("ArrowDown"); // one row down in the swatch grid
  const checkedColor = colorGroup(page).getByRole("radio", { checked: true });
  await expect(checkedColor).toBeFocused();
  await expect(checkedColor).not.toHaveAccessibleName("Verde");

  // → the icon grid: Space picks the first icon, arrows move through the grid.
  await page.keyboard.press("Tab");
  const house = iconGroup(page).getByRole("radio", { name: "Casa" });
  await expect(house).toBeFocused();
  await page.keyboard.press("Space");
  await expect(house).toBeChecked();
  await page.keyboard.press("ArrowDown");
  const checkedIcon = iconGroup(page).getByRole("radio", { checked: true });
  await expect(checkedIcon).toBeFocused();
  await expect(checkedIcon).not.toHaveAccessibleName("Casa");
  // Down lands exactly one row below: same column as Casa.
  const [houseBox, belowBox] = [await house.boundingBox(), await checkedIcon.boundingBox()];
  expect(belowBox!.x).toBeCloseTo(houseBox!.x, 0);
  expect(belowBox!.y).toBeGreaterThan(houseBox!.y);
  await page.keyboard.press("End");
  const wrench = iconGroup(page).getByRole("radio", { name: "Llave inglesa" });
  await expect(wrench).toBeChecked();
  // The preview stays in view while scrolling the icons, and never covers the focused one.
  const preview = sheet(page).locator(".bo-area-tag");
  await expect(preview).toBeInViewport();
  await expect(preview).toHaveClass(/bo-area--/);
  await page.keyboard.press("Home");
  await expect(house).toBeFocused();
  const [previewBox, houseTop] = [
    await sheet(page).locator(".bo-card").boundingBox(),
    (await house.boundingBox())!.y,
  ];
  expect(houseTop).toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height);
  await page.keyboard.press("End");
  await expect(wrench).toBeFocused();

  // → Cancelar → Crear área.
  await page.keyboard.press("Tab");
  await expect(sheet(page).getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sheet(page).getByRole("button", { name: "Crear área" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(sheet(page)).toBeHidden();
  await expect(newAreaButton(page)).toBeFocused();
  const row = list(page).getByRole("button", { name: `Editar ${name}` });
  await expect(row).toBeVisible();

  // Edit with the keyboard and leave with Esc: nothing saved, focus back on the row.
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(nameField(page)).toBeFocused();
  await expect(iconGroup(page).getByRole("radio", { name: "Llave inglesa" })).toBeChecked();
  await page.keyboard.type(" editado");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleName(`Editar ${name}`);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshots`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/areas");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(list(page)).toBeVisible();
    await fontsLoaded(page);

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const linux = process.platform === "linux";
    if (linux) {
      // Only the seeded rows: other tests add areas to the shared database.
      await expect(list(page)).toHaveScreenshot(`areas-list-${theme}.png`, {
        stylePath: SCREENSHOT_CSS,
      });
    }

    await newAreaButton(page).click();
    await nameField(page).fill("Música");
    await colorGroup(page).getByRole("radio", { name: "Lima" }).click();
    await iconGroup(page).getByRole("radio", { name: "Música" }).click();
    await expect(sheet(page).locator(".bo-area-tag")).toHaveText("Música");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // With errors showing too.
    await nameField(page).fill("");
    await sheet(page).getByRole("button", { name: "Crear área" }).click();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    if (linux) {
      await nameField(page).fill("Música");
      await nameField(page).blur();
      await expect(sheet(page)).toHaveScreenshot(`areas-sheet-${theme}.png`);
    }
  });
}
