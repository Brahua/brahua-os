import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  colorGroup,
  createArea,
  editRows,
  expect,
  iconGroup,
  isDesktop,
  list,
  nameField,
  newAreaButton,
  openAreas,
  rowIndex,
  SEEDED,
  sheet,
  sortableReady,
  test,
  testWithAreasLock,
  uniqueName,
} from "./support/areas";
import { animationsSettled } from "./support/animations";
import { fontsLoaded } from "./support/fonts";
import { expectScreenshot } from "./support/screenshots";

// Shared database: global-setup seeds the 8 default areas, and other tests create more in
// parallel. Each test uses its own names and never edits the seeded areas, which the
// screenshots show. Tests that create areas hold the areas lock (`testWithAreasLock`).

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = [
  path.join(__dirname, "support/hide-app-nav.css"),
  path.join(__dirname, "support/seeded-areas-only.css"),
];
/** The create/edit announcement (the notices have their own region, named "Avisos"). */
const status = (page: Page) => page.locator('main p[role="status"]').filter({ hasText: /./ });

type Announcement = { text: string; hidden: boolean; dialog: boolean };

/**
 * Records every text the status region gets, with whether it sat inside an aria-hidden
 * ancestor (Radix hides the page while a modal sheet is open) or a dialog was still open.
 */
async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    const seen: Announcement[] = [];
    (window as unknown as { __announcements: Announcement[] }).__announcements = seen;
    const region = document.querySelector('main p[role="status"]')!;
    new MutationObserver(() => {
      if (!region.textContent) return;
      seen.push({
        text: region.textContent,
        hidden: region.closest('[aria-hidden="true"]') !== null,
        dialog: document.querySelector('[role="dialog"]') !== null,
      });
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}

const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { __announcements: Announcement[] }).__announcements);

test("Áreas has its title, is in the navigation and lists the seeded areas in order", async ({
  page,
}, testInfo) => {
  await openAreas(page);
  await expect(page).toHaveTitle("Áreas · brahua-os");
  if (isDesktop(testInfo)) {
    await expect(page.getByRole("link", { name: "Áreas" })).toHaveAttribute("aria-current", "page");
  } else {
    // On the phone Áreas lives under "Más" (6 sections since Hábitos): the key says it is current.
    await expect(page.getByRole("button", { name: "Más (actual: Áreas)" })).toHaveAttribute(
      "data-active",
    );
  }

  const rows = editRows(page);
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

testWithAreasLock(
  "create an area: side panel on desktop, bottom sheet on the phone",
  async ({ page }, testInfo) => {
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

    await recordAnnouncements(page);
    await sheet(page).getByRole("button", { name: "Crear área" }).click();

    await expect(sheet(page)).toBeHidden();
    await expect(newAreaButton(page)).toBeFocused();
    await expect(status(page)).toHaveText(`Área «${name}» creada.`);
    // Announced only once nothing hides the page from screen readers anymore.
    expect(await announcements(page)).toEqual([
      { text: `Área «${name}» creada.`, hidden: false, dialog: false },
    ]);
    // After the seeded areas (other tests add theirs in parallel, so not necessarily last), and
    // still there after a reload.
    const row = list(page).getByRole("button", { name: `Editar ${name}` });
    await expect(row).toBeVisible();
    expect(await rowIndex(page, name)).toBeGreaterThanOrEqual(SEEDED.length);
    await page.reload();
    await expect(row).toBeVisible();
    expect(await rowIndex(page, name)).toBeGreaterThanOrEqual(SEEDED.length);
  },
);

testWithAreasLock(
  "edit an area: the row keeps its place and gets focus back",
  async ({ page }, testInfo) => {
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
  },
);

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
  await expect(iconGroup(page)).toHaveAccessibleDescription(/Elige un ícono\.$/);
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

testWithAreasLock(
  "keyboard only: open, fill, pick swatch and icon with arrows, save, Esc",
  async ({ page }, testInfo) => {
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
    // Measured in one frame: the side panel may still be sliding in.
    const [houseBox, belowBox] = await iconGroup(page).evaluate((group) => {
      const radios = [...group.querySelectorAll('[role="radio"]')];
      const box = (radio: Element | undefined) =>
        radio!.getBoundingClientRect().toJSON() as DOMRect;
      return [box(radios[0]), box(radios.find((radio) => radio.ariaChecked === "true"))];
    });
    expect(belowBox.x).toBeCloseTo(houseBox.x, 0);
    expect(belowBox.y).toBeGreaterThan(houseBox.y);
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
  },
);

test("short screen (320×256): the preview doesn't stick and every focused control shows", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "One small viewport is enough");
  await page.setViewportSize({ width: 320, height: 256 });
  // No slide-in: measure the sheet where it rests.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAreas(page);
  await newAreaButton(page).click();
  await expect(nameField(page)).toBeFocused();

  // The sheet's entry (1 ms with reduced motion) must be over before measuring: under load the
  // first check could run mid-entry (seen once in a full local run).
  await animationsSettled(page);
  const preview = sheet(page).locator(".bo-card").first();
  const wrapper = preview.locator("..");
  expect(await wrapper.evaluate((element) => getComputedStyle(element).position)).toBe("static");

  /** The focused element is on screen and it is what the page shows at its center. */
  const focusedIsVisible = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const inViewport = y >= 0 && y <= window.innerHeight && x >= 0 && x <= window.innerWidth;
      const top = document.elementFromPoint(x, y);
      return inViewport && top !== null && (top === element || element.contains(top));
    });

  expect(await focusedIsVisible()).toBe(true);
  // Name → color → icons → Cancelar → Crear área, then the arrows through the icons.
  for (const key of ["Tab", "Tab", "End", "Home", "ArrowDown", "Tab", "Tab"]) {
    await page.keyboard.press(key);
    expect(await focusedIsVisible(), `after ${key}`).toBe(true);
  }
  await expect(sheet(page).getByRole("button", { name: "Crear área" })).toBeFocused();
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
    // The handles look enabled only once dnd-kit has loaded.
    await sortableReady(page);

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // Only the seeded rows: other tests add areas to the shared database.
    await expectScreenshot(list(page), `areas-list-${theme}.png`, { stylePath: SCREENSHOT_CSS });

    await newAreaButton(page).click();
    await nameField(page).fill("Música");
    await colorGroup(page).getByRole("radio", { name: "Lima" }).click();
    await iconGroup(page).getByRole("radio", { name: "Música" }).click();
    await expect(sheet(page).locator(".bo-area-tag")).toHaveText("Música");
    // The picked keys fade to their "on" colors; measure contrast once they have settled.
    await animationsSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // With errors showing too.
    await nameField(page).fill("");
    await sheet(page).getByRole("button", { name: "Crear área" }).click();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await nameField(page).fill("Música");
    await nameField(page).blur();
    await expectScreenshot(sheet(page), `areas-sheet-${theme}.png`);
  });
}
