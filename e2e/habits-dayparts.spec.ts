import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  countHabitsByName,
  expect,
  insertHabit,
  openHabits,
  readHabitByName,
} from "./support/habits";
import { untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest as test } from "./support/today-tasks";

// R4 of `reminders`: a habit gets an optional «Hora del aviso» and a «Franja» in its form; with a
// franja, the pads of Hábitos → Hoy and of the board on "/" are grouped under Mañana / Tarde /
// Noche and «Sin franja» last. The board shows every habit and task due today, so this is a
// `boardTest` (the habits lock and the tasks lock, e2e/support/today-tasks.ts). It is ONE long
// test on purpose (the E2E job's time): the grouping's rules are in
// tests/app/habits-dayparts.test.tsx.

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

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

/** The accessible name of a franja's list (daypart-groups.ts `bandListLabel`). */
const band = (page: Page | Locator, label: string) =>
  page.getByRole("list", { name: `Hábitos de la franja ${label}` });

test("hora y franja: the form, Enter, a half-edited time, the grouped pads on Hábitos and on /", async ({
  page,
}, testInfo) => {
  const plain = unique("Leer", testInfo);
  const evening = unique("Meditar", testInfo);
  const edited = unique("Estirar", testInfo);
  await insertHabit({ name: plain, sortOrder: 0 });
  await insertHabit({ name: edited, sortOrder: 1, reminderTime: "21:30" });

  // ── The form: both fields optional and empty by default ──
  await openHabits(page);
  await expect(page.getByRole("list", { name: "Hábitos de hoy" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  const time = sheet.getByLabel("Hora del aviso");
  await expect(time).toHaveValue("");
  await expect(sheet.getByRole("radio", { name: "Sin franja" })).toBeChecked();

  // Touch targets: at least 48 px high.
  const clear = sheet.getByRole("button", { name: "Quitar hora" });
  for (const target of [
    time,
    clear,
    ...(await sheet.getByRole("radiogroup", { name: "Franja" }).getByRole("radio").all()),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
  }

  // Enter in «Nombre» sends the form for real, once.
  await time.fill("22:00");
  await sheet.getByRole("radio", { name: "Noche" }).click();
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(evening);
  await untilSaved(page, () => sheet.getByRole("textbox", { name: "Nombre" }).press("Enter"));
  await expect(sheet).toBeHidden();
  expect(await readHabitByName(evening)).toMatchObject({
    reminderTime: "22:00:00",
    daypart: "evening",
  });
  expect(await countHabitsByName(evening)).toBe(1);

  // Hábitos → Hoy: «Noche» first, then «Sin franja».
  const headings = page.getByRole("main").getByRole("heading", { level: 3 });
  await expect(headings).toHaveText(["Noche", "Sin franja"]);
  await expect(
    band(page, "noche").getByRole("button", { name: evening, exact: true }),
  ).toBeVisible();

  // ── A half-edited time: «Quitar hora» works and the old time does not survive silently ──
  await page.getByRole("button", { name: `Opciones de «${edited}»` }).click();
  await page.getByRole("dialog", { name: edited }).getByRole("button", { name: "Editar" }).click();
  const editSheet = page.getByRole("dialog", { name: "Editar hábito" });
  const editTime = editSheet.getByLabel("Hora del aviso");
  await expect(editTime).toHaveValue("21:30");
  await editTime.focus();
  await page.keyboard.press("Backspace");
  const editClear = editSheet.getByRole("button", { name: "Quitar hora" });
  await expect(editClear).not.toHaveAttribute("aria-disabled", "true");
  // Saving now is refused on the field (the time is incomplete), not saved as 21:30.
  await editSheet.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(editTime).toHaveAccessibleDescription(/hora válida/);
  expect((await readHabitByName(edited))?.reminderTime).toBe("21:30:00");
  await editClear.click();
  await expect(editTime).toHaveValue("");
  await editSheet.getByRole("radio", { name: "Tarde" }).click();
  await untilSaved(page, () => editSheet.getByRole("button", { name: "Guardar cambios" }).click());
  await expect(editSheet).toBeHidden();
  expect(await readHabitByName(edited)).toMatchObject({ reminderTime: null, daypart: "afternoon" });
  // The pad moved to another list: focus followed it (never <body>).
  await expect(
    band(page, "tarde").getByRole("button", { name: edited, exact: true }),
  ).toBeFocused();

  // ── The sheet and the grouped page, in both themes: axe, and 320 px without sideways scroll ──
  const size = page.viewportSize();
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expect(headings).toHaveText(["Tarde", "Noche", "Sin franja"]);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Nuevo hábito" }).click();
    await expect(page.getByRole("dialog", { name: "Nuevo hábito" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page
      .getByRole("dialog", { name: "Nuevo hábito" })
      .getByRole("button", { name: "Cancelar" })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.setViewportSize({ width: 320, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Nuevo hábito" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await axeViolations(page)).toEqual([]);
    await page
      .getByRole("dialog", { name: "Nuevo hábito" })
      .getByRole("button", { name: "Cancelar" })
      .click();
    if (size) await page.setViewportSize(size);
  }

  // ── The board: the same bands; a tap inside a band logs the day, and it survives a reload ──
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
  const section = page.getByRole("region", { name: "Hábitos" });
  await expect(section.getByRole("heading", { level: 3 })).toHaveText([
    "Tarde",
    "Noche",
    "Sin franja",
  ]);
  const night = band(section, "noche");
  await untilSaved(page, () => night.getByRole("button", { name: evening, exact: true }).click());
  await expect(night.getByRole("button", { name: evening, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-today-habits-count]")).toHaveText("1 de 3 cumplidos");

  for (const theme of THEMES) {
    await setTheme(page, theme);
    // A save that was lost would show here, after the reload.
    await expect(
      band(page.getByRole("region", { name: "Hábitos" }), "noche").getByRole("button", {
        name: evening,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-today-habits-count]")).toHaveText("1 de 3 cumplidos");
    expect(await axeViolations(page)).toEqual([]);

    await page.setViewportSize({ width: 320, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await axeViolations(page)).toEqual([]);
    if (size) await page.setViewportSize(size);
  }
});
