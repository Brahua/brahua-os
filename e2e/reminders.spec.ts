import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { afterSaveSettled } from "./support/saves";
import { fontsLoaded } from "./support/fonts";
import {
  E2E_CHAT_ID,
  E2E_TELEGRAM,
  failNextTelegramCall,
  fakeTelegramCalls,
  readReminderSettings,
  resetFakeTelegram,
  resetReminders,
  textUpdate,
  WEBHOOK_SECRET_HEADER,
} from "./support/reminders";
import { expectScreenshot } from "./support/screenshots";

// Ajustes → Avisos (R1 of `reminders`) against the fake Telegram Bot API (TELEGRAM_API_BASE, see
// playwright.config.ts). `reminder_settings` is ONE row for the whole app, so this file runs in
// the desktop project only (playwright.config.ts `testIgnore`s it in mobile; the 320 px checks
// resize the window), one test at a time, and leaves the row as a fresh install. The real
// Telegram and Apple Push are never reached from CI.
test.describe.configure({ mode: "serial" });

const THEMES = ["dark", "light"] as const;
const HIDE_APP_NAV = path.join(__dirname, "support/hide-app-nav.css");

test.beforeEach(async () => {
  await resetReminders();
  await resetFakeTelegram();
});
test.afterAll(async () => {
  await resetReminders();
  await resetFakeTelegram();
});

const telegram = (page: Page) => page.getByRole("region", { name: "Telegram" });

async function openReminders(page: Page) {
  await page.goto("/settings/reminders");
  await expect(page).toHaveTitle("Avisos · brahua-os");
  // Hydrated: the handlers are attached (AppNav marks <html> once its effects run).
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(page.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
  await telegramReady(page);
  await fontsLoaded(page);
}

/** The section is hydrated (it marks itself once its effects ran), so a click reaches React. */
async function telegramReady(page: Page) {
  await expect(telegram(page)).toHaveAttribute("data-telegram-ready", "true");
}

/** Presses "Conectar Telegram" and returns the one-use code from the link it shows. */
async function connect(page: Page): Promise<string> {
  await telegramReady(page);
  await telegram(page).getByRole("button", { name: "Conectar Telegram" }).click();
  const link = telegram(page).getByRole("link", { name: "Abrir Telegram" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(
    new RegExp(`^https://t\\.me/${E2E_TELEGRAM.botUsername}\\?start=[A-Z2-9]{8}$`),
  );
  return href!.split("start=")[1];
}

/** Telegram delivering `/start <code>` to the app's webhook, as the real bot would. */
async function startFromTelegram(
  page: Page,
  code: string,
  secret: string = E2E_TELEGRAM.webhookSecret,
) {
  return page.request.post("/api/telegram/webhook", {
    headers: { [WEBHOOK_SECRET_HEADER]: secret },
    data: textUpdate(`/start ${code}`),
  });
}

test("Ajustes links to Avisos, which opens with its title, a way back and Telegram", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  const region = page.getByRole("region", { name: "Avisos" });
  await expect(region).toBeVisible();
  await region.getByRole("link", { name: /Telegram y avisos del día/ }).click();

  await expect(page).toHaveURL("/settings/reminders");
  await expect(page.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
  await expect(telegram(page)).toBeVisible();
  await expect(telegram(page).getByText("Sin conectar.")).toBeVisible();
  await telegramReady(page);
  // Ajustes stays the current section in the navigation (the sidebar, on desktop).
  await expect(page.getByRole("banner").getByRole("link", { name: "Ajustes" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The way back.
  await page.getByRole("main").getByRole("link", { name: "Ajustes" }).click();
  await expect(page).toHaveURL("/settings");
});

test("connects with the one-use link: webhook registered, bot confirms, page shows Conectado, then disconnects", async ({
  page,
}) => {
  await openReminders(page);
  const code = await connect(page);

  // "Conectar" registered the webhook with the server's token and secret.
  const registered = (await fakeTelegramCalls()).filter((call) => call.method === "setWebhook");
  expect(registered).toHaveLength(1);
  expect(registered[0].token).toBe(E2E_TELEGRAM.token);
  expect(registered[0].body).toMatchObject({
    url: expect.stringMatching(/\/api\/telegram\/webhook$/),
    secret_token: E2E_TELEGRAM.webhookSecret,
  });
  // The link took the focus (the key that had it was replaced).
  await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toBeFocused();

  // The owner taps "Iniciar" in Telegram: the webhook receives /start <code>.
  expect((await startFromTelegram(page, code)).status()).toBe(200);

  // The page notices by itself (it polls while the link waits) and focuses Desconectar.
  await expect(telegram(page).getByText(/^Conectado desde el /)).toBeVisible({ timeout: 15_000 });
  await expect(telegram(page).getByRole("status")).toHaveText("Telegram quedó conectado.");
  await expect(telegram(page).getByRole("button", { name: "Desconectar" })).toBeFocused();
  await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toHaveCount(0);

  // The bot answered in the linked chat.
  const replies = (await fakeTelegramCalls()).filter((call) => call.method === "sendMessage");
  expect(replies).toHaveLength(1);
  expect(replies[0].body).toMatchObject({ chat_id: E2E_CHAT_ID });
  expect(String(replies[0].body.text)).toContain("brahua-os quedó conectado");

  // It survives a reload: the server has it.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(telegram(page).getByText(/^Conectado desde el /)).toBeVisible();

  // Desconectar: back to the start, with the focus on Conectar.
  await telegram(page).getByRole("button", { name: "Desconectar" }).click();
  await expect(telegram(page).getByText("Sin conectar.")).toBeVisible();
  await expect(telegram(page).getByRole("status")).toHaveText("Telegram quedó desconectado.");
  await expect(telegram(page).getByRole("button", { name: "Conectar Telegram" })).toBeFocused();
});

test("a wrong secret, no secret and a wrong code link nothing; the right code with the right secret does", async ({
  page,
}) => {
  await openReminders(page);
  const code = await connect(page);

  // Wrong secret: 401, and nothing happens (negative test with a positive control below).
  expect((await startFromTelegram(page, code, "not-the-webhook-secret-xxxxxx")).status()).toBe(401);
  // No secret at all.
  const bare = await page.request.post("/api/telegram/webhook", { data: textUpdate("hola") });
  expect(bare.status()).toBe(401);
  // A wrong code from a stranger is answered with nothing...
  await resetFakeTelegram();
  expect((await startFromTelegram(page, "ABCDEFGH")).status()).toBe(200);
  // ...and the database says so (no sleeping until a poll would have noticed): no chat is linked
  // and the owner's code is still live and unspent.
  const afterWrong = await readReminderSettings();
  expect(afterWrong.telegramChatId).toBeNull();
  expect(afterWrong.liveCodes).toEqual([{ usedAt: null }]);
  expect(afterWrong.codes).toHaveLength(1);
  expect((await fakeTelegramCalls()).filter((call) => call.method === "sendMessage")).toEqual([]);
  await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toBeVisible();

  // Positive control: the right code with the right secret links.
  expect((await startFromTelegram(page, code)).status()).toBe(200);
  await expect(telegram(page).getByText(/^Conectado desde el /)).toBeVisible({ timeout: 15_000 });
});

test("when Telegram refuses the webhook the page says so and offers to try again", async ({
  page,
}) => {
  await openReminders(page);
  await failNextTelegramCall("setWebhook", 401);
  await telegram(page).getByRole("button", { name: "Conectar Telegram" }).click();
  await expect(telegram(page).getByRole("alert")).toContainText(
    "Telegram no aceptó el registro del bot",
  );
  // No link was created, and the key is still there with its focus (aria-disabled, not disabled).
  await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toHaveCount(0);
  const key = telegram(page).getByRole("button", { name: "Conectar Telegram" });
  await expect(key).toBeVisible();
  await expect(key).toBeFocused();
  await expect(key).not.toBeDisabled();
  // Positive control: trying again works.
  await key.click();
  await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toBeVisible();
});

test("the tick endpoint answers 404 to anyone without the secret and counts only to who has it", async ({
  request,
}) => {
  for (const headers of [
    {} as Record<string, string>,
    { authorization: "Bearer nope" },
    { authorization: E2E_TELEGRAM.cronSecret },
  ]) {
    const response = await request.post("/api/reminders/tick", { headers });
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("");
  }
  const ok = await request.post("/api/reminders/tick", {
    headers: { authorization: `Bearer ${E2E_TELEGRAM.cronSecret}` },
  });
  expect(ok.status()).toBe(200);
  // Nothing is connected and no source is registered yet: it did nothing, and says so in counts.
  expect(await ok.json()).toEqual({
    ok: true,
    status: "no-channel",
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  });
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (not connected, link waiting, connected; 320 px too) and the reference screenshot`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings/reminders");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    await expect(telegram(page)).toBeVisible();
    await telegramReady(page);
    await fontsLoaded(page);
    await afterSaveSettled(page);

    const clean = async () =>
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const noSidewaysScroll = async (width: number) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );

    // Not connected, on desktop.
    await clean();
    await expectScreenshot(page.getByRole("main"), `reminders-${theme}.png`, {
      stylePath: HIDE_APP_NAV,
    });

    // The link waiting to be opened, on desktop.
    const code = await connect(page);
    await afterSaveSettled(page);
    await clean();

    // The same state at 320 px: no sideways scroll and still clean.
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(telegram(page).getByRole("link", { name: "Abrir Telegram" })).toBeVisible();
    await noSidewaysScroll(320);
    await clean();

    // Connected, at 320 px too.
    expect((await startFromTelegram(page, code)).status()).toBe(200);
    await expect(telegram(page).getByText(/^Conectado desde el /)).toBeVisible({ timeout: 15_000 });
    await afterSaveSettled(page);
    await noSidewaysScroll(320);
    await clean();
  });
}
