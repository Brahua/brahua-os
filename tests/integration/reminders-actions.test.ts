// @vitest-environment node
// R1.2/R1.4 of `reminders`: the Server Actions of Ajustes → Avisos against Postgres and the fake
// Bot API: the owner is checked first, "Conectar" registers the webhook with the server's own
// token and secret and hands out the one-use link, "Desconectar" clears everything.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import {
  connectTelegram,
  disconnectTelegramChat,
  getTelegramStatus,
  updateReminderSettings,
} from "@/modules/reminders/actions";
import { hashLinkCode, redeemLinkCode } from "@/modules/reminders/channels/telegram/link";
import { reminderSettings, telegramLinkCodes } from "@/modules/reminders/db/schema";
import {
  TELEGRAM_ALREADY_CONNECTED_MESSAGE,
  TELEGRAM_NOT_CONFIGURED_MESSAGE,
  TELEGRAM_WEBHOOK_FAILED_MESSAGE,
} from "@/modules/reminders/reminders-copy";
import { getSettings } from "@/modules/reminders/settings";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const TOKEN = "123456:actions-test-token";
const WEBHOOK_SECRET = "a-webhook-secret-0123456789";

let fake: FakeTelegram;

beforeAll(async () => {
  fake = await startFakeTelegram();
});

afterAll(async () => {
  await fake.close();
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  fake.reset();
  vi.mocked(revalidatePath).mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    ...AUTH_ENV,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_USERNAME: "@brahua_test_bot",
    TELEGRAM_API_BASE: fake.url,
  };
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const liveCodes = () => testDb.select().from(telegramLinkCodes);

async function connected() {
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: 5_000_000_001, linkedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(reminderSettings.id, true));
}

describe("connectTelegram", () => {
  test("registers the webhook with the server's token and secret and returns the one-use link", async () => {
    const result = await connectTelegram({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "setWebhook", token: TOKEN });
    expect(fake.calls[0].body).toMatchObject({
      url: `${AUTH_ENV.BETTER_AUTH_URL}/api/telegram/webhook`,
      secret_token: WEBHOOK_SECRET,
    });

    const match = /^https:\/\/t\.me\/brahua_test_bot\?start=([A-HJ-NP-Z2-9]{8})$/.exec(
      result.data.url,
    );
    expect(match).not.toBeNull();
    const code = match![1];
    // Only the hash is stored.
    const [row] = await liveCodes();
    expect(row.codeHash).toBe(hashLinkCode(code));
    expect(JSON.stringify(row)).not.toContain(code);
    expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(new Date(result.data.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/reminders");

    // The link works: that is the chat linking.
    expect(await redeemLinkCode(testDb, { code, chatId: 5_000_000_001, now: new Date() })).toBe(
      "linked",
    );
  });

  test("the result never carries the token or the webhook secret", async () => {
    const result = await connectTelegram({});
    const text = JSON.stringify(result);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(WEBHOOK_SECRET);
  });

  test("asking again gives a new link and the old one stops working", async () => {
    const first = await connectTelegram({});
    const second = await connectTelegram({});
    if (!first.ok || !second.ok) throw new Error("connect failed");
    const codeOf = (url: string) => url.split("start=")[1];
    expect(codeOf(first.data.url)).not.toBe(codeOf(second.data.url));
    expect(
      await redeemLinkCode(testDb, { code: codeOf(first.data.url), chatId: 1, now: new Date() }),
    ).toBe("invalid");
    expect(
      await redeemLinkCode(testDb, { code: codeOf(second.data.url), chatId: 1, now: new Date() }),
    ).toBe("linked");
  });

  test("without the bot's variables it says so and does not call Telegram", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await connectTelegram({})).toEqual({
      ok: false,
      error: TELEGRAM_NOT_CONFIGURED_MESSAGE,
    });
    expect(fake.calls).toHaveLength(0);
    expect(await liveCodes()).toEqual([]);
  });

  test("when Telegram refuses the webhook, no code is created", async () => {
    fake.queue("setWebhook", { status: 401 });
    expect(await connectTelegram({})).toEqual({
      ok: false,
      error: TELEGRAM_WEBHOOK_FAILED_MESSAGE,
    });
    expect(await liveCodes()).toEqual([]);
  });

  test("while a chat is connected it is refused before touching Telegram", async () => {
    await getSettings(testDb);
    await connected();
    expect(await connectTelegram({})).toEqual({
      ok: false,
      error: TELEGRAM_ALREADY_CONNECTED_MESSAGE,
    });
    expect(fake.calls).toHaveLength(0);
    expect(await liveCodes()).toEqual([]);
  });
});

describe("disconnectTelegramChat and getTelegramStatus", () => {
  test("disconnecting clears the chat and closes the pending link", async () => {
    const link = await connectTelegram({});
    if (!link.ok) throw new Error("connect failed");
    await connected();

    const result = await disconnectTelegramChat({});
    expect(result).toMatchObject({ ok: true, data: { state: "disconnected", linkedLabel: null } });
    const settings = await getSettings(testDb);
    expect(settings).toMatchObject({
      telegramChatId: null,
      linkedAt: null,
      telegramBlockedAt: null,
    });
    expect((await liveCodes())[0].usedAt).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/reminders");
  });

  test("the status reports connected, blocked and disconnected, and what is missing", async () => {
    expect(await getTelegramStatus({})).toMatchObject({
      ok: true,
      data: { state: "disconnected", configured: true, problems: [] },
    });

    await getSettings(testDb);
    await connected();
    expect(await getTelegramStatus({})).toMatchObject({
      ok: true,
      data: { state: "connected", linkedLabel: expect.stringMatching(/^1 oct\.? 2026$/) },
    });

    await testDb
      .update(reminderSettings)
      .set({ telegramChatId: null, linkedAt: null, telegramBlockedAt: new Date() });
    expect(await getTelegramStatus({})).toMatchObject({ ok: true, data: { state: "blocked" } });

    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const missing = await getTelegramStatus({});
    expect(missing).toMatchObject({ ok: true, data: { configured: false } });
    if (missing.ok) {
      expect(missing.data.problems.join(" ")).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
      expect(JSON.stringify(missing)).not.toContain(TOKEN);
    }
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    await getSettings(testDb);
    await connected();
    request.headers = await headers();
    for (const call of [
      () => connectTelegram({}),
      () => disconnectTelegramChat({}),
      () => getTelegramStatus({}),
      () => updateReminderSettings({ briefingEnabled: false, briefingTime: "09:00" }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    // Still connected, no Telegram call, no code, and the schedule is untouched.
    const settings = await getSettings(testDb);
    expect(settings.telegramChatId).toBe(5_000_000_001);
    expect(settings.briefingEnabled).toBe(true);
    expect(settings.briefingTime).toBe("07:30:00");
    expect(fake.calls).toHaveLength(0);
    expect(await liveCodes()).toEqual([]);
  });
});

describe("updateReminderSettings", () => {
  test("saves one field and returns the schedule as stored", async () => {
    const result = await updateReminderSettings({ briefingEnabled: false });
    expect(result).toEqual({
      ok: true,
      data: {
        briefingEnabled: false,
        briefingTime: "07:30",
        paymentsEnabled: true,
        eveningEnabled: true,
        eveningTime: "21:00",
        showAmountsTelegram: true,
      },
    });
    expect((await getSettings(testDb)).briefingEnabled).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/reminders");
  });

  test("saves times and switches together; the rest stays as it was", async () => {
    const result = await updateReminderSettings({
      briefingTime: "08:15",
      eveningTime: "22:00",
      paymentsEnabled: false,
      showAmountsTelegram: false,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        briefingEnabled: true,
        briefingTime: "08:15",
        paymentsEnabled: false,
        eveningEnabled: true,
        eveningTime: "22:00",
        showAmountsTelegram: false,
      },
    });
    const row = await getSettings(testDb);
    // Stored without seconds (a CHECK would refuse them).
    expect([row.briefingTime, row.eveningTime]).toEqual(["08:15:00", "22:00:00"]);
  });

  test("works on a fresh install (the settings row does not exist yet)", async () => {
    expect(await testDb.select().from(reminderSettings)).toEqual([]);
    const result = await updateReminderSettings({ eveningEnabled: false });
    expect(result.ok).toBe(true);
    expect((await getSettings(testDb)).eveningEnabled).toBe(false);
  });

  test("never touches the Telegram link", async () => {
    await getSettings(testDb);
    await connected();
    await updateReminderSettings({ briefingEnabled: false });
    expect((await getSettings(testDb)).telegramChatId).toBe(5_000_000_001);
  });

  test("invalid input is refused with the field's error and stores nothing", async () => {
    await getSettings(testDb);
    for (const input of [
      { briefingTime: "7:30" },
      { eveningTime: "21:00:30" },
      { briefingEnabled: "yes" },
      {},
      { telegramChatId: 1 },
      { deliveryChannel: "both" },
      { showAmountsPush: true },
    ]) {
      const result = await updateReminderSettings(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
    const bad = await updateReminderSettings({ briefingTime: "25:00" });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { briefingTime: expect.any(Array) } });
    const row = await getSettings(testDb);
    expect(row.briefingTime).toBe("07:30:00");
    expect(row.telegramChatId).toBeNull();
    expect(row.deliveryChannel).toBe("push");
    expect(row.showAmountsPush).toBe(false);
  });
});
