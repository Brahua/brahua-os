import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  habitsCount,
  insertHabit,
  limaWeekday,
  notDueToggle,
  openHabitPage,
  openHabits,
  pad,
  pads,
  readDay,
  readPauses,
  readPausesWithReason,
  test,
} from "./support/habits";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest } from "./support/today-tasks";

// "Saltar hoy" (polish): from the options of a pad in Hábitos → Hoy and from the little sheet of
// the board on "/", 2 taps rest the habit for today (a one-day pause "Descanso") with a notice
// "Deshacer"; the habit's page says "N días saltados este mes". Every test holds the habits lock
// and starts from an empty "Hoy" (e2e/support/habits.ts); the board tests are `boardTest`s.

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

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

const streak = (page: Page, name: string) => pad(page, name).locator("[data-habit-streak]");
const pausedToggle = (page: Page) => page.getByRole("button", { name: /^En pausa/ });

async function openOptions(page: Page, name: string) {
  await page.getByRole("button", { name: `Opciones de «${name}»` }).click();
  return page.getByRole("dialog", { name });
}

/** Opens "/" and waits until it is hydrated (taps reach React) and laid out (fonts in). */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

const boardCount = (page: Page) => page.locator("[data-today-habits-count]");
const boardPad = (page: Page, name: string) =>
  pads(page).getByRole("button", { name, exact: true });

/** The habit's page streak, read in a tab of its own (the notice stays on the first one). */
async function pageStreak(page: Page, id: string) {
  const detail = await page.context().newPage();
  try {
    await openHabitPage(detail, id);
    return await detail
      .locator('[data-habit-stat="current"] .bo-stat__value .sr-only')
      .textContent();
  } finally {
    await detail.close();
  }
}

test("Hoy: two taps rest the pad (En pausa, 'Descanso'), the day is neutral for the streak, Deshacer brings it back", async ({
  page,
}, testInfo) => {
  const name = unique("Gimnasio", testInfo);
  const other = unique("Leer", testInfo);
  // Done today and the 3 days before: a streak of 4 that the rest must make 3 (the rested day
  // is neutral, so it neither counts nor breaks), and Deshacer must make 4 again.
  const id = await insertHabit({ name, done: true, doneDays: [-3, -2, -1], sortOrder: 0 });
  await insertHabit({ name: other, sortOrder: 1 });
  await openHabits(page);
  await expect(habitsCount(page)).toHaveText("1 de 2 hoy");
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 4");
  expect(await pageStreak(page, id)).toBe("4");

  // Tap 1: the options. Tap 2: "Saltar hoy".
  const options = await openOptions(page, name);
  await untilSaved(page, () => options.getByRole("button", { name: "Saltar hoy" }).click());

  // The pad rested: out of the grid and the count, in "En pausa" with its reason; focus is on
  // its "Reanudar" key (never <body>).
  await expect(pads(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");
  await expect(page.getByRole("button", { name: `Reanudar «${name}»` })).toBeFocused();
  await expect(page.getByText(/^En pausa hasta el .* · Descanso$/)).toBeVisible();
  await expect(notices(page).getByText(`«${name}» descansa hoy.`)).toBeVisible();
  await expect(notices(page).getByText("Descanso", { exact: true })).toBeVisible();
  // One pause of one day, today, with the reason "Descanso"; the log stays stored.
  await expect
    .poll(() => readPausesWithReason(id))
    .toEqual([{ startDate: limaDay(0), endDate: limaDay(0), reason: "Descanso" }]);
  expect(await readDay(id, 0)).toBe(1);
  // The rested day is neutral: the streak is 3 (4 would mean the day still counted).
  expect(await pageStreak(page, id)).toBe("3");

  // Deshacer brings the pad back and the streak with it.
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pad(page, name)).toBeVisible();
  await expect(pad(page, name)).toBeFocused();
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 4");
  await expect(habitsCount(page)).toHaveText("1 de 2 hoy");
  await expect.poll(() => readPauses(id)).toEqual([]);
  expect(await pageStreak(page, id)).toBe("4");
  await page.reload();
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 4");
});

test("Hoy: resting the last pad leaves focus on its Reanudar; a quantity with a partial value keeps it", async ({
  page,
}, testInfo) => {
  const name = unique("Agua", testInfo);
  const id = await insertHabit({
    name,
    quantity: { goal: 8, unit: "vasos", today: 3 },
    doneDays: [-1],
  });
  await openHabits(page);
  await expect(pad(page, name)).toContainText("3/8");
  const options = await openOptions(page, name);
  await untilSaved(page, () => options.getByRole("button", { name: "Saltar hoy" }).click());
  // The grid has nothing left: focus is somewhere defined, never <body>.
  await expect(page.getByRole("button", { name: `Reanudar «${name}»` })).toBeFocused();
  await expect(page.locator("[data-habits-nothing-today]")).toBeVisible();
  // The 3 of 8 is still stored while it rests.
  expect(await readDay(id, 0)).toBe(3);
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pad(page, name)).toContainText("3/8");
  await expect(pad(page, name)).toBeFocused();
});

test("Hoy: a habit already done today rests too, and what it had logged comes back with Deshacer", async ({
  page,
}, testInfo) => {
  const name = unique("Meditar", testInfo);
  const id = await insertHabit({ name, done: true, doneDays: [-1] });
  await openHabits(page);
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
  const options = await openOptions(page, name);
  await untilSaved(page, () => options.getByRole("button", { name: "Saltar hoy" }).click());
  await expect(pad(page, name)).toHaveCount(0);
  // The log stays stored (the rest only makes the day neutral).
  expect(await readDay(id, 0)).toBe(1);
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => readPauses(id)).toEqual([]);
});

test("Hoy: the key is only offered where it makes sense", async ({ page }, testInfo) => {
  const plain = unique("Leer", testInfo);
  const resting = unique("Correr", testInfo);
  const avoid = unique("No fumar", testInfo);
  const notToday = unique("Otro día", testInfo);
  const weekly = unique("Semanal", testInfo);
  await insertHabit({ name: notToday, weekdays: [limaWeekday(1)], sortOrder: 3 });
  await insertHabit({ name: weekly, weeklyTarget: 3, sortOrder: 4 });
  await insertHabit({ name: plain, sortOrder: 0 });
  await insertHabit({ name: resting, pause: { start: -1, end: 3, reason: "Viaje" }, sortOrder: 1 });
  await insertHabit({ name: avoid, kind: "avoid", sortOrder: 2 });
  await openHabits(page);

  // Positive control: a habit to keep has it.
  let options = await openOptions(page, plain);
  await expect(options.getByRole("button", { name: "Saltar hoy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();

  // A habit to avoid has none.
  options = await openOptions(page, avoid);
  await expect(options.getByRole("button", { name: "Pausar" })).toBeVisible();
  await expect(options.getByRole("button", { name: "Saltar hoy" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();

  // "X por semana" is due every day: it has it. Fixed days of another day (in "No tocan hoy")
  // don't.
  options = await openOptions(page, weekly);
  await expect(options.getByRole("button", { name: "Saltar hoy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await notDueToggle(page).click();
  options = await openOptions(page, notToday);
  await expect(options.getByRole("button", { name: "Pausar" })).toBeVisible();
  await expect(options.getByRole("button", { name: "Saltar hoy" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();

  // One already resting today offers Reanudar, not Saltar hoy.
  await pausedToggle(page).click();
  options = await openOptions(page, resting);
  await expect(options.getByRole("button", { name: "Reanudar" })).toBeVisible();
  await expect(options.getByRole("button", { name: "Saltar hoy" })).toHaveCount(0);
});

test("the habit's page says '2 días saltados este mes', and nothing at 0", async ({
  page,
}, testInfo) => {
  const month = limaDay(0).slice(0, 7);
  const name = unique("Gimnasio", testInfo);
  const none = unique("Leer", testInfo);
  const id = await insertHabit({
    name,
    pauses: [
      { startDate: `${month}-01`, endDate: `${month}-01`, reason: "Descanso" },
      { startDate: `${month}-02`, endDate: `${month}-02`, reason: "Descanso" },
      // Not skips: another reason, and a longer pause.
      { startDate: `${month}-03`, endDate: `${month}-03`, reason: "Viaje" },
      { startDate: `${month}-10`, endDate: `${month}-12`, reason: "Descanso" },
    ],
  });
  const withNone = await insertHabit({
    name: none,
    pauses: [{ startDate: `${month}-03`, endDate: `${month}-03`, reason: "Viaje" }],
  });
  await openHabitPage(page, id);
  const skipped = page.locator("[data-habit-skipped]");
  await expect(skipped).toHaveText("2 días saltados este mes");
  await openHabitPage(page, withNone);
  await expect(page.locator("[data-habit-skipped]")).toHaveCount(0);
});

test("at 320 px Hoy and its notice don't scroll sideways after resting a long-named habit @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const name = `Un hábito con un nombre bastante largo para la tarjeta ${testInfo.project.name}`;
  await insertHabit({ name, sortOrder: 0 });
  await insertHabit({ name: "Leer", sortOrder: 1 });
  await page.setViewportSize({ width: 320, height: 640 });
  await openHabits(page);
  const options = await openOptions(page, name);
  const key = options.getByRole("button", { name: "Saltar hoy" });
  const box = await key.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await untilSaved(page, () => key.click());
  await expect(notices(page).getByText(/descansa hoy/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await pausedToggle(page).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the options with Saltar hoy, the notice, En pausa)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Leer", area: "learning", doneDays: [-2, -1], sortOrder: 0 });
    await insertHabit({ name: "Gimnasio", area: "health", sortOrder: 1 });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 2 });
    await openHabits(page);
    await setTheme(page, theme);

    const options = await openOptions(page, "Gimnasio");
    await expect(options.getByRole("button", { name: "Saltar hoy" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await untilSaved(page, () => options.getByRole("button", { name: "Saltar hoy" }).click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reanudar «Gimnasio»" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

// ── The board on "/" ──

boardTest(
  "/: the corner key, then Saltar hoy: the pad leaves, the notice undoes it",
  async ({ page }, testInfo) => {
    const name = unique("Meditar", testInfo);
    const next = unique("Leer", testInfo);
    const id = await insertHabit({ name, doneDays: [-2, -1], sortOrder: 0 });
    await insertHabit({ name: next, sortOrder: 1 });
    await openToday(page);
    await expect(boardCount(page)).toHaveText("0 de 2 cumplidos");

    await page.getByRole("button", { name: `Opciones de «${name}»` }).click();
    const sheet = page.getByRole("dialog", { name });
    await untilSaved(page, () => sheet.getByRole("button", { name: "Saltar hoy" }).click());

    await expect(boardPad(page, name)).toHaveCount(0);
    await expect(boardCount(page)).toHaveText("0 de 1 cumplidos");
    // Focus goes to the next pad (never <body>).
    await expect(boardPad(page, next)).toBeFocused();
    await expect(notices(page).getByText(`«${name}» descansa hoy.`)).toBeVisible();
    await expect
      .poll(() => readPausesWithReason(id))
      .toEqual([{ startDate: limaDay(0), endDate: limaDay(0), reason: "Descanso" }]);

    await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
    await expect(boardPad(page, name)).toBeVisible();
    await expect(boardPad(page, name)).toBeFocused();
    await expect(boardCount(page)).toHaveText("0 de 2 cumplidos");
    await expect.poll(() => readPauses(id)).toEqual([]);
  },
);

boardTest(
  "/: a habit already resting is not on the board, one to avoid has no key (positive control: the others do)",
  async ({ page }, testInfo) => {
    const keep = unique("Leer", testInfo);
    const resting = unique("Correr", testInfo);
    const avoid = unique("No fumar", testInfo);
    await insertHabit({ name: keep, sortOrder: 0 });
    await insertHabit({ name: resting, pause: { start: 0, end: 2 }, sortOrder: 1 });
    await insertHabit({ name: avoid, kind: "avoid", sortOrder: 2 });
    await openToday(page);
    await expect(boardPad(page, keep)).toBeVisible();
    await expect(boardPad(page, resting)).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Opciones de «${keep}»` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Opciones de «${resting}»` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Opciones de «${avoid}»` })).toHaveCount(0);
  },
);

boardTest(
  "/: the last pad resting leaves the board calm, and Deshacer brings it back",
  async ({ page }, testInfo) => {
    const name = unique("Meditar", testInfo);
    await insertHabit({ name });
    await openToday(page);
    await page.getByRole("button", { name: `Opciones de «${name}»` }).click();
    const sheet = page.getByRole("dialog", { name });
    await untilSaved(page, () => sheet.getByRole("button", { name: "Saltar hoy" }).click());
    await expect(page.getByRole("region", { name: "Hábitos" })).toHaveCount(0);
    await expect(page.locator("#today-title")).toBeFocused();
    await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
    await expect(boardPad(page, name)).toBeVisible();
    await expect(boardPad(page, name)).toBeFocused();
  },
);

boardTest(
  "/ at 320 px: a quantity pad with two corner keys keeps its LED and area icon clear of them",
  async ({ page }, testInfo) => {
    boardTest.skip(isDesktop(testInfo), "Phone widths only");
    await insertHabit({
      name: "Tomar agua con un nombre largo largo largo",
      area: "health",
      quantity: { goal: 8, unit: "vasos", today: 3 },
      sortOrder: 0,
    });
    await insertHabit({ name: "Meditar", area: "health", sortOrder: 1 });
    await page.setViewportSize({ width: 320, height: 640 });
    await openToday(page);
    for (const index of [0, 1]) {
      const cell = pads(page).locator("li").nth(index);
      const keys = cell.getByRole("button", { name: /^(Ajustar|Opciones)/ });
      await expect(keys).toHaveCount(index === 0 ? 2 : 1);
      const marks = [
        await cell.locator(".bo-led").first().boundingBox(),
        await cell.locator("svg").first().boundingBox(),
      ];
      for (const key of await keys.all()) {
        const box = await key.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(40);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        for (const mark of marks) {
          // The mark is left of the key or above/below it: the boxes never intersect.
          const apart =
            mark!.x + mark!.width <= box!.x ||
            box!.x + box!.width <= mark!.x ||
            mark!.y + mark!.height <= box!.y ||
            box!.y + box!.height <= mark!.y;
          expect(apart).toBe(true);
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  },
);

boardTest(
  "/: every pad of a row is as tall as its neighbor, a habit to avoid (no corner key) too",
  async ({ page }) => {
    await insertHabit({
      name: "Meditar con un nombre largo para que ocupe dos líneas",
      sortOrder: 0,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 1 });
    await openToday(page);
    const first = await pads(page).locator("[data-habit-pad]").nth(0).boundingBox();
    const second = await pads(page).locator("[data-habit-pad]").nth(1).boundingBox();
    expect(first!.height).toBeGreaterThanOrEqual(112);
    expect(second!.height).toBe(first!.height);
  },
);

for (const theme of THEMES) {
  boardTest(
    `/ ${theme} theme: no accessibility violations (the sheet, the notice)`,
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await insertHabit({ name: "Meditar", area: "health", sortOrder: 0 });
      await insertHabit({
        name: "Tomar agua",
        area: "health",
        quantity: { goal: 8, unit: "vasos", today: 3 },
        sortOrder: 1,
      });
      await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 2 });
      await openToday(page);
      await setTheme(page, theme);
      expect(await axeViolations(page)).toEqual([]);

      await page.getByRole("button", { name: "Opciones de «Meditar»" }).click();
      const sheet = page.getByRole("dialog", { name: "Meditar" });
      await expect(sheet.getByRole("button", { name: "Saltar hoy" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await untilSaved(page, () => sheet.getByRole("button", { name: "Saltar hoy" }).click());
      await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    },
  );
}
