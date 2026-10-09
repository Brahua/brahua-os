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
  readDeliveryChannel,
  readPushSubscriptions,
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
const schedule = (page: Page) => page.getByRole("region", { name: "Avisos del día" });
const channel = (page: Page) => page.getByRole("region", { name: "Canal de avisos" });

async function openReminders(page: Page) {
  await page.goto("/settings/reminders");
  await expect(page).toHaveTitle("Avisos · brahua-os");
  // Hydrated: the handlers are attached (AppNav marks <html> once its effects run).
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(page.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
  await telegramReady(page);
  await scheduleReady(page);
  await channelReady(page);
  await fontsLoaded(page);
}

/** "Canal de avisos" is hydrated and knows the state of this device (it marks itself when it does). */
async function channelReady(page: Page) {
  await expect(channel(page)).toHaveAttribute("data-push-ready", "true");
}

/** "Avisos del día" is hydrated too (it marks itself like Telegram does). */
async function scheduleReady(page: Page) {
  await expect(schedule(page)).toHaveAttribute("data-schedule-ready", "true");
}

/** Runs `action` and waits for the Server Action it triggers to answer, and for the page to say so. */
async function saved(page: Page, action: () => Promise<void>) {
  const answer = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/settings/reminders"),
  );
  await action();
  expect((await answer).ok()).toBe(true);
  // The page took the answer in and announced it (it clears the message when a save starts).
  await expect(schedule(page).getByRole("status")).toHaveText("Guardado.");
}

/** Counts the saves ("Avisos del día" posts to its own page) from now on. */
function countSaves(page: Page): () => number {
  let count = 0;
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().endsWith("/settings/reminders")) {
      count++;
    }
  });
  return () => count;
}

/**
 * Touch targets: the time fields are at least 48 px high and so is each switch's row (the design
 * system's switch is 30 px; its row, with the label that toggles it, is the target).
 */
async function expectTouchTargets(page: Page) {
  const region = schedule(page);
  for (const label of ["Hora del resumen", "Hora del repaso"]) {
    const box = await region.getByLabel(label).boundingBox();
    expect(box!.height, label).toBeGreaterThanOrEqual(48);
  }
  for (const control of await region.getByRole("switch").all()) {
    const row = await control.locator("xpath=..").boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(48);
  }
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

test("Avisos del día: the switches and the times save, say so, keep their focus and survive a reload", async ({
  page,
}) => {
  await openReminders(page);
  const region = schedule(page);
  const briefing = region.getByRole("switch", { name: "Resumen de la mañana" });
  const payments = region.getByRole("switch", { name: "Avisos de pagos" });
  const eveningSwitch = region.getByRole("switch", { name: "Repaso de la noche" });
  const amounts = region.getByRole("switch", { name: "Montos en Telegram" });
  const briefingTime = region.getByLabel("Hora del resumen");
  const eveningTime = region.getByLabel("Hora del repaso");

  // A fresh install shows the defaults.
  await expect(briefing).toHaveAttribute("aria-checked", "true");
  await expect(briefingTime).toHaveValue("07:30");
  await expect(eveningTime).toHaveValue("21:00");
  await expectTouchTargets(page);

  // A switch saves when touched, announces it and keeps the focus.
  await briefing.focus();
  await saved(page, () => briefing.press("Space"));
  await expect(briefing).toHaveAttribute("aria-checked", "false");
  await expect(briefing).toBeFocused();
  await expect(briefing).not.toBeDisabled();

  // A time saves with Intro and the field keeps the focus.
  await briefingTime.fill("08:30");
  await saved(page, () => briefingTime.press("Enter"));
  await expect(briefingTime).toBeFocused();

  // The other two switches.
  await saved(page, () => payments.click());
  await saved(page, () => eveningSwitch.click());
  await expect(payments).toHaveAttribute("aria-checked", "false");
  await expect(eveningSwitch).toHaveAttribute("aria-checked", "false");

  // A time typed and then a click on a switch, with no Intro in between: leaving the field saves
  // the time and the click on the switch (made while that save is in flight) is not lost.
  const saves = countSaves(page);
  await eveningTime.fill("22:15");
  await amounts.click();
  await expect.poll(saves).toBe(2);
  await expect(region.getByRole("status")).toHaveText("Guardado.");
  await expect(amounts).toHaveAttribute("aria-checked", "false");
  await expect(eveningTime).toHaveValue("22:15");

  // The server has all of it.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await scheduleReady(page);
  await expect(briefing).toHaveAttribute("aria-checked", "false");
  await expect(briefingTime).toHaveValue("08:30");
  await expect(payments).toHaveAttribute("aria-checked", "false");
  await expect(eveningSwitch).toHaveAttribute("aria-checked", "false");
  await expect(amounts).toHaveAttribute("aria-checked", "false");
  await expect(eveningTime).toHaveValue("22:15");
});

/**
 * A browser with push, simulated (the real service worker and push services cannot be driven
 * reliably from Playwright, and CI never reaches Apple's or Google's). The subscription lives in
 * localStorage so it survives a reload, like a real one; the endpoint is a host the server's
 * allowlist accepts. The server side (actions, database, channel selection) is the real one.
 */
async function simulatePush(page: Page, options: { permission?: "default" | "denied" } = {}) {
  await page.addInitScript(
    ({ endpoint, keys, permission }) => {
      const SUBSCRIPTION = "e2e-push-subscription";
      const define = (target: object, key: string, value: unknown) =>
        Object.defineProperty(target, key, { value, configurable: true, writable: true });
      const current = () =>
        localStorage.getItem(SUBSCRIPTION)
          ? {
              endpoint,
              options: { applicationServerKey: null },
              toJSON: () => ({ endpoint, keys }),
              unsubscribe: async () => {
                localStorage.removeItem(SUBSCRIPTION);
                return true;
              },
            }
          : null;
      const registration = {
        pushManager: {
          getSubscription: async () => current(),
          subscribe: async () => {
            localStorage.setItem(SUBSCRIPTION, "1");
            return current();
          },
        },
      };
      define(navigator, "serviceWorker", {
        register: async () => registration,
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
      });
      define(window, "PushManager", class PushManager {});
      let state: string = permission;
      define(window, "Notification", {
        get permission() {
          return state;
        },
        requestPermission: async () => {
          state = permission === "denied" ? "denied" : "granted";
          return state;
        },
      });
    },
    {
      endpoint: "https://web.push.apple.com/e2e-device",
      keys: { p256dh: "B".padEnd(87, "p"), auth: "a".repeat(22) },
      permission: options.permission ?? "default",
    },
  );
}

test("Canal de avisos: the choice saves; this device turns push on and off; amounts in push start off", async ({
  page,
}) => {
  await simulatePush(page);
  await openReminders(page);
  const region = channel(page);
  const note = region.getByText(
    /^Los avisos llegan|^Todavía no hay|^Ahora mismo|^Telegram no está/,
  );

  // A fresh install: Push is the default, and with nothing connected nothing is sent (and it says so).
  await expect(region.getByRole("radio", { name: "Push" })).toHaveAttribute("aria-checked", "true");
  await expect(note).toContainText("no se envía ningún aviso");
  await expect(region.getByText("Este dispositivo no recibe avisos por push.")).toBeVisible();
  for (const radio of await region.getByRole("radio").all()) {
    expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Activate this device: the browser asks, subscribes, and the server records it.
  const activate = region.getByRole("button", { name: "Activar este dispositivo" });
  await activate.click();
  const deactivate = region.getByRole("button", { name: "Desactivar este dispositivo" });
  await expect(deactivate).toBeVisible();
  await expect(deactivate).toBeFocused();
  await expect(region.getByRole("status")).toHaveText("Este dispositivo quedó activado.");
  await expect(region.getByText("Este dispositivo recibe avisos por push.")).toBeVisible();
  await expect(note).toHaveText("Los avisos llegan por push (1 dispositivo).");
  await expect(region.getByRole("list", { name: "Dispositivos con push" })).toContainText(
    /· Chrome · desde el /,
  );
  expect(await readPushSubscriptions()).toEqual([
    { endpoint: "https://web.push.apple.com/e2e-device", revoked: false },
  ]);

  // The choice saves and survives a reload together with the device.
  await region.getByRole("radio", { name: "Ambos" }).click();
  await expect(region.getByRole("radio", { name: "Ambos" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(region.getByRole("status")).toHaveText("Guardado.");
  await expect(note).toContainText("Conecta Telegram");
  expect(await readDeliveryChannel()).toBe("both");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await channelReady(page);
  await expect(region.getByRole("radio", { name: "Ambos" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(region.getByText("Este dispositivo recibe avisos por push.")).toBeVisible();
  await expect(region.getByRole("button", { name: "Desactivar este dispositivo" })).toBeVisible();
  await afterSaveSettled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Montos en push: off by default, saves like the other switches.
  const amountsPush = schedule(page).getByRole("switch", { name: "Montos en push" });
  await scheduleReady(page);
  await expect(amountsPush).toHaveAttribute("aria-checked", "false");
  await saved(page, () => amountsPush.click());
  await expect(amountsPush).toHaveAttribute("aria-checked", "true");

  // Desactivar: the device stops receiving (the row stays, revoked) and the key comes back.
  await region.getByRole("button", { name: "Desactivar este dispositivo" }).click();
  await expect(region.getByRole("button", { name: "Activar este dispositivo" })).toBeFocused();
  await expect(region.getByRole("status")).toHaveText("Este dispositivo quedó desactivado.");
  await expect(region.getByText("Este dispositivo no recibe avisos por push.")).toBeVisible();
  await expect(region.getByRole("list", { name: "Dispositivos con push" })).toHaveCount(0);
  expect(await readPushSubscriptions()).toEqual([
    { endpoint: "https://web.push.apple.com/e2e-device", revoked: true },
  ]);
  // A reload agrees: the browser's own subscription is gone too.
  await page.reload();
  await channelReady(page);
  await expect(region.getByRole("button", { name: "Activar este dispositivo" })).toBeVisible();
});

test("a blocked notification permission is explained, with no key that cannot work", async ({
  page,
}) => {
  await simulatePush(page, { permission: "denied" });
  await openReminders(page);
  const region = channel(page);
  await expect(region.getByText(/El permiso de notificaciones está bloqueado/)).toBeVisible();
  await expect(region.getByRole("button", { name: /Activar este dispositivo/ })).toHaveCount(0);
  expect(await readPushSubscriptions()).toEqual([]);
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
  // Nothing is connected, so the engine did nothing (it does not even ask the sources), and says so in counts.
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
    await scheduleReady(page);
    await channelReady(page);
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
    await expectTouchTargets(page);

    // Connected, at 320 px too.
    expect((await startFromTelegram(page, code)).status()).toBe(200);
    await expect(telegram(page).getByText(/^Conectado desde el /)).toBeVisible({ timeout: 15_000 });
    await afterSaveSettled(page);
    await noSidewaysScroll(320);
    await clean();
  });
}
