import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { expect, insertHabit, limaWeekday, readHabit, test } from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// D1 of `today` (SPEC-today): the board on "/" with today's habits, logged as in Hábitos → Hoy,
// and the calm empty day. Every test holds the habits lock (e2e/support/habits.ts): the board
// shows every habit due today, so these tests can't share them with the habits specs running in
// parallel; each starts with no habits.

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

/** Opens "/" and waits until it is hydrated (taps reach React). */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const section = (page: Page) => page.getByRole("region", { name: "Hábitos" });
const pads = (page: Page) => page.getByRole("list", { name: "Hábitos de hoy" });
const pad = (page: Page, name: string) => pads(page).getByRole("button", { name, exact: true });
const count = (page: Page) => page.locator("[data-today-habits-count]");
const empty = (page: Page) => page.getByRole("region", { name: "Nada programado para hoy" });

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

test("a habit logged from / with one tap, and Deshacer", async ({ page }, testInfo) => {
  const name = unique("Meditar", testInfo);
  const id = await insertHabit({ name, sortOrder: 0 });
  await insertHabit({ name: "Leer", done: true, sortOrder: 1 });
  // Fixed days of another day: not due today, so not on the board.
  await insertHabit({ name: "Otro día", weekdays: [limaWeekday(1)], sortOrder: 2 });
  await openToday(page);

  await expect(empty(page)).toHaveCount(0);
  await expect(count(page)).toHaveText("1 de 2 cumplidos");
  await expect(pads(page).locator("[data-habit-pad]")).toHaveCount(2);
  // First in the manual order, before the one already done.
  const first = pads(page).locator("li").first().getByRole("button", { name, exact: true });
  await expect(first).toBeVisible();

  await untilSaved(page, () => pad(page, name).click());
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
  await expect(count(page)).toHaveText("2 de 2 cumplidos");
  // It stays where it was (manual order): a done pad never moves under the finger (reduced
  // motion below also checks it doesn't move a pixel).
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(notices(page).getByText(new RegExp(`«${name}» quedó hecho hoy`))).toBeVisible();
  await expect.poll(async () => (await readHabit(id)).today).toBe(1);

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "false");
  await expect(count(page)).toHaveText("1 de 2 cumplidos");
  await expect.poll(async () => (await readHabit(id)).today).toBe(0);

  // "Ver hábitos" goes to the module.
  await section(page).getByRole("link", { name: "Ver hábitos" }).click();
  await expect(page).toHaveURL("/habits");
});

test("a quantity adds its step; Ajustar sets the exact amount, with Deshacer", async ({
  page,
}, testInfo) => {
  const name = unique("Agua", testInfo);
  const id = await insertHabit({ name, quantity: { goal: 8, unit: "vasos", step: 2, today: 3 } });
  await openToday(page);
  const status = pad(page, name).locator(".bo-key__sub:not([data-habit-streak])");
  await expect(status).toHaveText("3/8 VASOS");

  await untilSaved(page, () => pad(page, name).click());
  await expect(status).toHaveText("5/8 VASOS");
  await expect.poll(async () => (await readHabit(id)).today).toBe(5);

  const adjust = pads(page).getByRole("button", { name: `Ajustar «${name}»` });
  await adjust.click();
  const sheet = page.getByRole("dialog", { name: `Ajustar «${name}»` });
  const field = sheet.getByRole("textbox", { name: "Cantidad (vasos)" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("5");
  await field.fill("8");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  // Focus back on the key that opened it.
  await expect(adjust).toBeFocused();
  await expect(status).toHaveText("8/8 VASOS");
  await expect(count(page)).toHaveText("1 de 1 cumplidos");
  await expect.poll(async () => (await readHabit(id)).today).toBe(8);

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(status).toHaveText("5/8 VASOS");
  await expect.poll(async () => (await readHabit(id)).today).toBe(5);
});

test("a habit to avoid: one tap logs a relapse, without guilt", async ({ page }, testInfo) => {
  const name = unique("No fumar", testInfo);
  const id = await insertHabit({ name, kind: "avoid" });
  await openToday(page);
  await expect(count(page)).toHaveText("1 de 1 cumplidos");
  const slip = pads(page).getByRole("button", { name: `Registrar recaída: ${name}` });
  await untilSaved(page, () => slip.click());
  await expect(slip).toHaveAttribute("aria-pressed", "true");
  await expect(count(page)).toHaveText("0 de 1 cumplidos");
  await expect.poll(async () => (await readHabit(id)).today).toBe(1);
});

test("an empty day: a calm message with links, no Hábitos section", async ({ page }) => {
  await openToday(page);
  await expect(empty(page)).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await expect(empty(page).getByRole("link", { name: "Ir a Tareas" })).toHaveAttribute(
    "href",
    "/tasks",
  );
  await empty(page).getByRole("link", { name: "Ir a Hábitos" }).click();
  await expect(page).toHaveURL("/habits");

  // Positive control: with a habit due today the section is back and the empty day is gone.
  await insertHabit({ name: "Estirar" });
  await openToday(page);
  await expect(section(page)).toBeVisible();
  await expect(empty(page)).toHaveCount(0);
});

test("at 320 px the board doesn't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertHabit({ name: "Un hábito con un nombre bastante largo para una pantalla angosta" });
  await insertHabit({ name: "Tomar agua", quantity: { goal: 10_000, unit: "a".repeat(20) } });
  await insertHabit({ name: "No fumar", kind: "avoid" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(pads(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  // Two columns on the phone.
  const [first, second] = await pads(page).locator("li").evaluateAll((items) =>
    items.slice(0, 2).map((item) => item.getBoundingClientRect().top),
  );
  expect(first).toBe(second);
});

test("reduced motion: a tapped pad neither moves nor sinks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await insertHabit({ name: "Meditar", sortOrder: 0 });
  await insertHabit({ name: "Leer", sortOrder: 1 });
  await openToday(page);
  const before = await pad(page, "Meditar").boundingBox();
  await untilSaved(page, () => pad(page, "Meditar").click());
  await expect(pad(page, "Meditar")).toHaveAttribute("aria-pressed", "true");
  await afterSaveSettled(page);
  // A pressed key sinks by --motion-travel, which is 0 with reduced motion.
  const transform = await pad(page, "Meditar").evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  expect(await pad(page, "Meditar").boundingBox()).toEqual(before);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (empty day, habits, a tap, adjust)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openToday(page);
    await setTheme(page, theme);
    await expect(empty(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await insertHabit({ name: "Meditar", area: "health", done: true, sortOrder: 0 });
    await insertHabit({ name: "Leer 20 páginas", area: "learning", sortOrder: 1 });
    await insertHabit({
      name: "Tomar agua",
      area: "health",
      quantity: { goal: 8, unit: "vasos", today: 3 },
      sortOrder: 2,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 3 });
    await page.reload();
    await expect(pads(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    expect(await axeViolations(page)).toEqual([]);

    // A tap, then the notice.
    await untilSaved(page, () => pad(page, "Leer 20 páginas").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await pads(page).getByRole("button", { name: "Ajustar «Tomar agua»" }).click();
    const adjust = page.getByRole("dialog", { name: "Ajustar «Tomar agua»" });
    await expect(adjust.getByRole("textbox")).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the Hábitos section (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Meditar 10 min", area: "health", done: true, sortOrder: 0 });
    await insertHabit({ name: "Leer 20 páginas", area: "learning", sortOrder: 1 });
    await insertHabit({
      name: "Tomar agua",
      area: "health",
      quantity: { goal: 8, unit: "vasos", today: 3 },
      sortOrder: 2,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 3 });
    await openToday(page);
    await setTheme(page, theme);
    await expect(count(page)).toHaveText("2 de 4 cumplidos");
    await afterSaveSettled(page);
    // Only the section: the header's greeting and date change with the hour.
    await expectScreenshot(section(page), `today-habits-${theme}.png`);
  });
}
