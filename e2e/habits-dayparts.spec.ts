import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { expect, habitsCount, insertHabit, openHabits, readHabitByName } from "./support/habits";
import { untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest as test } from "./support/today-tasks";

// R4 of `reminders`: a habit gets an optional «Hora del aviso» and a «Franja» in its form; with a
// franja, the pads of Hábitos → Hoy and of the board on "/" are grouped under Mañana / Tarde /
// Noche and «Sin franja» last. The board shows every habit and task due today, so this is a
// `boardTest` (the habits lock and the tasks lock, e2e/support/today-tasks.ts). The grouping's
// rules (every band, the order, no franja at all) are in tests/app/habits-dayparts.test.tsx.

const THEMES = ["dark", "light"] as const;

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

test("a habit saved with a time and a franja is grouped under it on Hábitos and on /", async ({
  page,
}, testInfo) => {
  const plain = unique("Leer", testInfo);
  const evening = unique("Meditar", testInfo);
  await insertHabit({ name: plain, sortOrder: 0 });

  // The form: both fields are optional and empty by default.
  await openHabits(page);
  await expect(page.getByRole("list", { name: "Hábitos de hoy" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  await expect(sheet.getByLabel("Hora del aviso")).toHaveValue("");
  await expect(sheet.getByRole("radio", { name: "Sin franja" })).toBeChecked();
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(evening);
  await sheet.getByLabel("Hora del aviso").fill("22:00");
  await sheet.getByRole("radio", { name: "Noche" }).click();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear hábito" }).click());
  await expect(sheet).toBeHidden();
  expect(await readHabitByName(evening)).toMatchObject({
    reminderTime: "22:00:00",
    daypart: "evening",
  });

  // Hábitos → Hoy: the new habit is under «Noche», the other under «Sin franja».
  await expect(page.getByRole("main").getByRole("heading", { level: 3 })).toHaveText([
    "Noche",
    "Sin franja",
  ]);
  await expect(
    page.getByRole("list", { name: "Noche" }).getByRole("button", { name: evening, exact: true }),
  ).toBeVisible();
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");

  // The board: the same bands; a tap inside a band logs the day.
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
  const section = page.getByRole("region", { name: "Hábitos" });
  await expect(section.getByRole("heading", { level: 3 })).toHaveText(["Noche", "Sin franja"]);
  const night = section.getByRole("list", { name: "Noche" });
  await untilSaved(page, () => night.getByRole("button", { name: evening, exact: true }).click());
  await expect(night.getByRole("button", { name: evening, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-today-habits-count]")).toHaveText("1 de 2 cumplidos");

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await afterSaveSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
