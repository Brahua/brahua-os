import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  insertCleaning,
  insertProduct,
  insertRecipe,
  openHousehold,
  readCleaning,
  readProduct,
  readRecipe,
  test,
} from "./support/household";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H3 of `household`: the module's ONE E2E spec (CI budget). The three views as the owner uses them:
// a cleaning added, done («la siguiente conserva la zona») and undone; the shopping list (add,
// check off, «Terminé la compra», a suggestion that keeps the category and quantity it had); a
// recipe added with its link, filtered and removed with «Deshacer»; axe in both themes on the
// three views; 320 px without sideways scroll; one screenshot (the shopping list). Every test holds
// the household lock and starts from nothing (e2e/support/household.ts); the cleaning ones carry
// `@today-tasks` (their tasks are due today).

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

/** ISO weekday (1 = Monday … 7 = Sunday) of Lima's today, by this process's clock. */
function todayWeekday(): number {
  const day = new Date(`${limaDay(0)}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const WEEKDAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

test("cleaning: add a daily one, mark it done (the next keeps its zone) and undo @responsive @today-tasks", async ({
  page,
}, testInfo) => {
  const title = `Limpiar inodoro ${testInfo.project.name}`;
  await openHousehold(page);
  await expect(page.getByText("Nada que limpiar por ahora.")).toBeVisible();

  await page.getByRole("button", { name: "Añadir limpieza" }).click();
  const sheet = page.getByRole("dialog", { name: "Añadir limpieza" });
  await sheet.getByRole("textbox", { name: "Qué hay que limpiar" }).fill(title);
  await sheet.getByLabel("Zona", { exact: true }).fill("Baño");
  await sheet.getByLabel("Con qué frecuencia").selectOption("daily");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Añadir", exact: true }).click());
  await expect(sheet).toBeHidden();

  // It sits under its zone, due today, and the task is tagged for the view and for the zone.
  const zone = page.locator('[data-household-zone="baño"]');
  await expect(zone.getByRole("heading", { name: /^Baño/ })).toBeVisible();
  await expect(zone.getByText("Cada día · toca hoy")).toBeVisible();
  const [created] = await readCleaning(title);
  expect(created).toMatchObject({
    dueDate: limaDay(0),
    doneAt: null,
    tags: ["limpieza", "zona: baño"],
  });

  // «Hecho»: the row leaves, the notice says when the next one comes up, and the next one keeps
  // the cleaning tag and the zone (the only link between occurrences).
  await untilSaved(page, () => page.getByRole("button", { name: `Hecho: ${title}` }).click());
  await expect(
    notices(page).getByText(`«${title}» está hecha. La siguiente toca el`),
  ).toBeVisible();
  await expect.poll(async () => (await readCleaning(title)).length).toBe(2);
  const rows = await readCleaning(title);
  const next = rows.find((row) => row.doneAt === null)!;
  expect(next.dueDate).toBe(limaDay(1));
  expect(next.tags).toEqual(["limpieza", "zona: baño"]);

  // «Deshacer»: that task is pending again and the occurrence it created is gone.
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(page.getByRole("button", { name: `Hecho: ${title}` })).toBeVisible();
  await expect
    .poll(async () =>
      (await readCleaning(title)).filter((row) => row.deletedAt === null && row.doneAt === null),
    )
    .toHaveLength(1);
});

test("shopping: add, check off, «Terminé la compra» and a suggestion that keeps what it had @responsive", async ({
  page,
}) => {
  await openHousehold(page, "compras");
  await expect(page.getByText("La lista está vacía.")).toBeVisible();

  // A new product with its category and quantity.
  await page.getByRole("textbox", { name: "Producto" }).fill("Leche");
  await page.getByLabel("Categoría").selectOption("lacteos");
  await page.getByRole("textbox", { name: "Cantidad" }).fill("2 L");
  await untilSaved(page, () => page.getByRole("button", { name: "Añadir", exact: true }).click());
  const dairy = page.locator('[data-shopping-category="lacteos"]');
  await expect(dairy.getByText("Leche")).toBeVisible();
  await expect(dairy.getByLabel("Cantidad de Leche")).toHaveValue("2 L");
  await expect(page.getByRole("textbox", { name: "Producto" })).toBeFocused();
  expect(await readProduct("Leche")).toMatchObject({
    status: "needed",
    category: "lacteos",
    quantity: "2 L",
  });

  // The same name again (other case and accent) doesn't duplicate it.
  await page.getByRole("textbox", { name: "Producto" }).fill("leche");
  await expect(page.getByText("«Leche» ya está en la lista.")).toBeVisible();

  // Check it off: it goes to «Comprados»; «Terminé la compra» keeps it known and says so.
  await untilSaved(page, () => page.getByRole("button", { name: "Comprado: Leche" }).click());
  await expect(page.locator("[data-shopping-bought]").getByText("1 comprado")).toBeVisible();
  await untilSaved(page, () => page.getByRole("button", { name: "Terminé la compra" }).click());
  await expect(notices(page).getByText("Guardaste 1 producto.")).toBeVisible();
  await expect.poll(async () => (await readProduct("Leche"))?.status).toBe("idle");

  // Typing finds it again; one tap puts it on the list with the category and quantity it had.
  await page.getByRole("textbox", { name: "Producto" }).fill("lec");
  await untilSaved(page, () =>
    page.getByRole("button", { name: "Añadir Leche (Lácteos)" }).click(),
  );
  await expect(
    page.locator('[data-shopping-category="lacteos"]').getByLabel("Cantidad de Leche"),
  ).toHaveValue("2 L");
  expect(await readProduct("Leche")).toMatchObject({
    status: "needed",
    category: "lacteos",
    quantity: "2 L",
  });
});

test("recipes: add one with its link, filter it, remove it and undo @responsive", async ({
  page,
}) => {
  const weekday = todayWeekday();
  await openHousehold(page, "recetas");
  await expect(page.getByText("Aún no hay recetas.")).toBeVisible();

  await page.getByRole("button", { name: "Añadir receta" }).click();
  const sheet = page.getByRole("dialog", { name: "Añadir receta" });
  await sheet.getByRole("textbox", { name: "Nombre" }).fill("Arroz con pollo");
  await sheet.getByRole("button", { name: "Almuerzo" }).click();
  await sheet.getByRole("button", { name: WEEKDAY_NAMES[weekday - 1] }).click();
  // A link that is not http(s) is refused on its own field.
  await sheet.getByRole("textbox", { name: "Enlace" }).fill("javascript:alert(1)");
  await sheet.getByRole("button", { name: "Guardar" }).click();
  await expect(sheet.getByText(/empiece por http/)).toBeVisible();
  await sheet.getByRole("textbox", { name: "Enlace" }).fill("https://www.example.com/arroz");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();

  // «Para hoy» has it (today's weekday), and its link opens safely in another tab.
  const today = page.locator("[data-recipes-today]");
  const link = today.getByRole("link", { name: /Arroz con pollo/ });
  await expect(link).toHaveAttribute("href", "https://www.example.com/arroz");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(today.getByText(/example\.com/)).toBeVisible();
  expect(await readRecipe("Arroz con pollo")).toMatchObject({
    mealTypes: ["lunch"],
    weekdays: [weekday],
    url: "https://www.example.com/arroz",
  });

  // The filters live in the URL: a meal it doesn't suit hides it; tapping again clears.
  await page.getByRole("link", { name: "Filtrar por Cena" }).click();
  await expect(page).toHaveURL(/tipo=dinner/);
  await expect(page.getByText("Ninguna receta con ese filtro.")).toBeVisible();
  await page.getByRole("link", { name: "Filtrar por Cena" }).click();
  await expect(page).not.toHaveURL(/tipo=/);
  await expect(page.locator("[data-recipes-list]").getByText("Arroz con pollo")).toBeVisible();

  // «Quitar» and «Deshacer».
  await untilSaved(page, () =>
    page
      .locator("[data-recipes-list]")
      .getByRole("button", { name: "Quitar: Arroz con pollo" })
      .click(),
  );
  await expect(page.locator("[data-recipes-list]")).toBeHidden();
  await expect.poll(async () => await readRecipe("Arroz con pollo")).toBeUndefined();
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(page.locator("[data-recipes-list]").getByText("Arroz con pollo")).toBeVisible();
  expect(await readRecipe("Arroz con pollo")).toBeDefined();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the three views, the forms) @today-tasks`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertCleaning("Limpiar inodoro", "baño");
    await insertCleaning("Trapear sala", "sala/comedor", 2);
    await insertProduct({ name: "Leche", category: "lacteos", quantity: "2 L" });
    await insertProduct({ name: "Pan" });
    await insertProduct({ name: "Café", status: "bought" });
    await insertProduct({ name: "Arroz", status: "idle" });
    await insertRecipe({
      name: "Arroz con pollo",
      mealTypes: ["lunch"],
      weekdays: [todayWeekday()],
      url: "https://www.example.com/arroz",
    });
    await insertRecipe({ name: "Avena", mealTypes: ["breakfast"] });

    await openHousehold(page);
    await setTheme(page, theme);
    await expect(page.getByRole("heading", { name: /^Baño/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // By day, and the form with its errors.
    await page.getByRole("link", { name: "Por día" }).click();
    await expect(page.getByRole("heading", { name: /^Hoy · / })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Añadir limpieza" }).click();
    const form = page.getByRole("dialog", { name: "Añadir limpieza" });
    await form.getByRole("button", { name: "Añadir", exact: true }).click();
    await expect(form.getByText("Escribe qué hay que limpiar.")).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Qué hay que limpiar" })).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toBeHidden();

    // The shopping list with its three sections open.
    await openHousehold(page, "compras");
    await expect(page.locator('[data-shopping-category="lacteos"]')).toBeVisible();
    await page.getByText("Comprados", { exact: false }).first().click();
    await page.getByText("Productos guardados").click();
    expect(await axeViolations(page)).toEqual([]);

    // The recipes, filtered, and the sheet with its errors.
    await openHousehold(page, "recetas");
    await expect(page.locator("[data-recipes-today]")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Añadir receta" }).click();
    const recipeForm = page.getByRole("dialog", { name: "Añadir receta" });
    await recipeForm.getByRole("button", { name: "Guardar" }).click();
    await expect(recipeForm.getByText("Escribe el nombre de la receta.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px the three views don't scroll sideways @responsive @today-tasks", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertCleaning(
    "Una limpieza con un nombre bastante largo para una pantalla angosta",
    "dormitorio principal",
  );
  await insertProduct({
    name: "Un producto con un nombre bastante largo para una pantalla angosta",
    quantity: "2 docenas",
  });
  await insertRecipe({
    name: "Una receta con un nombre bastante largo para una pantalla angosta",
    mealTypes: ["lunch", "dinner"],
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    url: "https://www.example.com/una/ruta/muy/larga/de/una/receta/que/no/cabe",
  });
  await page.setViewportSize({ width: 320, height: 640 });
  for (const view of ["limpieza", "compras", "recetas"] as const) {
    await openHousehold(page, view);
    await expect(page.locator(`[data-household-view="${view}"]`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test("the shopping list: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await insertProduct({ name: "Zanahoria", category: "verduras", quantity: "1 kg" });
  await insertProduct({ name: "Manzana", category: "frutas", quantity: "6" });
  await insertProduct({ name: "Pollo", category: "carnes" });
  await insertProduct({ name: "Leche", category: "lacteos", quantity: "2 L" });
  await insertProduct({ name: "Jabón", category: "limpieza" });
  await insertProduct({ name: "Pan", status: "bought" });
  await openHousehold(page, "compras");
  await setTheme(page, "dark");
  await afterSaveSettled(page);
  await expectScreenshot(
    page.locator('[data-household-view="compras"]'),
    "household-shopping.png",
    {
      stylePath: SCREENSHOT_CSS,
    },
  );
});
