// @vitest-environment node
// R1.3 of `reminders`: the engine against real Postgres. The claim on `(dedupe_key, channel)` is
// what makes a reminder go out once, so the central test runs two ticks AT THE SAME TIME, with a
// positive control (two different reminders at the same time do go out twice). Telegram is the
// fake Bot API server through the real client and channel.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type {
  ChannelSendResult,
  ReminderCandidate,
  ReminderChannel,
  ReminderSource,
} from "@/modules/reminders/contracts";
import { createTelegramChannel } from "@/modules/reminders/channels/telegram/channel";
import { createTelegramClient } from "@/modules/reminders/channels/telegram/client";
import {
  pushSubscriptions,
  reminderDeliveries,
  reminderSettings,
  telegramLinkCodes,
} from "@/modules/reminders/db/schema";
import { runTick, type TickSummary } from "@/modules/reminders/engine";
import type { ChannelId } from "@/modules/reminders/reminders-constants";
import { getSettings } from "@/modules/reminders/settings";
import { limaInstant } from "@/modules/reminders/slots";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";
import { testDb } from "./test-db";

const CHAT_ID = 5_000_000_042;
const TOKEN = "123456:integration-token";
const DUE = limaInstant("2026-10-08", "07:30");
const NOW = new Date(DUE.getTime() + 5 * 60_000); // 07:35 in Lima

let fake: FakeTelegram;
beforeAll(async () => {
  fake = await startFakeTelegram();
});
afterAll(async () => {
  await fake.close();
});

beforeEach(async () => {
  fake.reset();
  await getSettings(testDb);
  await connectTelegram();
});

async function connectTelegram() {
  await testDb
    .update(reminderSettings)
    .set({
      telegramChatId: CHAT_ID,
      linkedAt: new Date("2026-10-01T12:00:00Z"),
      telegramBlockedAt: null,
    })
    .where(eq(reminderSettings.id, true));
}

const telegramChannel = () =>
  createTelegramChannel({
    client: createTelegramClient({ token: TOKEN, apiBase: fake.url }),
    chatId: CHAT_ID,
    appUrl: "https://os.brahua.com",
  });

function candidate(
  overrides: Partial<ReminderCandidate> & { text?: string | null } = {},
): ReminderCandidate {
  const { text = "Buen día.", ...rest } = overrides;
  return {
    kind: "briefing",
    dedupeKey: "briefing:2026-10-08",
    dueAt: DUE,
    build: async () => text,
    ...rest,
  };
}

const source = (...candidates: ReminderCandidate[]): ReminderSource => ({
  id: "test",
  candidates: async () => candidates,
});

function tick(
  sources: ReminderSource[],
  options: { now?: Date; channels?: Partial<Record<ChannelId, ReminderChannel>> } = {},
): Promise<TickSummary> {
  return runTick({
    db: testDb,
    now: options.now ?? NOW,
    sources,
    channelsFor: () => options.channels ?? { telegram: telegramChannel() },
  });
}

const deliveries = () =>
  testDb
    .select()
    .from(reminderDeliveries)
    .orderBy(reminderDeliveries.dedupeKey, reminderDeliveries.channel);
const sentMessages = () => fake.calls.filter((call) => call.method === "sendMessage");

/** A channel that takes its time, so two ticks really overlap. */
function slowChannel(delayMs = 150) {
  const sent: string[] = [];
  const channel: ReminderChannel = {
    id: "telegram",
    send: async (message) => {
      sent.push(message.dedupeKey);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ok: true, messageId: sent.length };
    },
  };
  return { channel, sent };
}

describe("a tick against Postgres", () => {
  test("sends a due reminder once through Telegram and records it without its text", async () => {
    const summary = await tick([source(candidate({ text: "Buen día. Hoy: 3 hábitos." }))]);
    expect(summary).toEqual({ status: "ok", candidates: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0].body).toMatchObject({
      chat_id: CHAT_ID,
      text: "Buen día. Hoy: 3 hábitos.\nhttps://os.brahua.com",
    });

    const [row] = await deliveries();
    expect(row).toMatchObject({
      kind: "briefing",
      channel: "telegram",
      dedupeKey: "briefing:2026-10-08",
      status: "sent",
      attempts: 1,
      errorCode: null,
      telegramMessageId: 1000,
    });
    expect(row.scheduledFor).toEqual(DUE);
    expect(row.sentAt).toEqual(NOW);
    // The table never holds the text.
    expect(JSON.stringify(row)).not.toContain("hábitos");
  });

  test("two ticks at the same time send ONE reminder (the claim)", async () => {
    const { channel, sent } = slowChannel();
    const [first, second] = await Promise.all([
      tick([source(candidate())], { channels: { telegram: channel } }),
      tick([source(candidate())], { channels: { telegram: channel } }),
    ]);
    expect(sent).toEqual(["briefing:2026-10-08"]);
    expect(first.sent + second.sent).toBe(1);
    expect(await deliveries()).toMatchObject([{ status: "sent", attempts: 1 }]);
  });

  test("positive control: two different reminders at the same time both go out", async () => {
    const { channel, sent } = slowChannel();
    const other = candidate({
      kind: "evening_review",
      dedupeKey: "evening_review:2026-10-07",
      dueAt: limaInstant("2026-10-08", "06:00"),
    });
    await Promise.all([
      tick([source(candidate())], { channels: { telegram: channel } }),
      tick([source(other)], { channels: { telegram: channel } }),
    ]);
    expect(sent.sort()).toEqual(["briefing:2026-10-08", "evening_review:2026-10-07"]);
    expect(await deliveries()).toHaveLength(2);
  });

  test("a rerun of the workflow later in the window sends nothing more", async () => {
    await tick([source(candidate())]);
    await tick([source(candidate())], { now: new Date(NOW.getTime() + 15 * 60_000) });
    await tick([source(candidate())], { now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(sentMessages()).toHaveLength(1);
  });

  test("outside the window it is skipped, never sent, and recorded once", async () => {
    const afternoon = limaInstant("2026-10-08", "14:00");
    const first = await tick([source(candidate())], { now: afternoon });
    const second = await tick([source(candidate())], { now: afternoon });
    expect(sentMessages()).toHaveLength(0);
    expect(first.skipped).toBe(1);
    expect(second.skipped).toBe(0);
    expect(await deliveries()).toMatchObject([
      { status: "skipped", errorCode: "window_expired", attempts: 0 },
    ]);
  });

  test("not due yet: nothing is recorded", async () => {
    await tick([source(candidate())], { now: new Date(DUE.getTime() - 60_000) });
    expect(await deliveries()).toEqual([]);
    expect(sentMessages()).toHaveLength(0);
  });

  test("an empty reminder is recorded as skipped and not sent", async () => {
    const summary = await tick([source(candidate({ text: null }))]);
    expect(summary).toMatchObject({ sent: 0, skipped: 1 });
    expect(sentMessages()).toHaveLength(0);
    expect(await deliveries()).toMatchObject([{ status: "skipped", errorCode: "empty" }]);
  });

  test("a switched-off kind is left alone", async () => {
    await testDb.update(reminderSettings).set({ briefingEnabled: false });
    await tick([source(candidate())]);
    expect(await deliveries()).toEqual([]);
    expect(sentMessages()).toHaveLength(0);
  });
});

describe("Telegram fails", () => {
  test("a failure is retried by the next tick, at most 3 attempts in all", async () => {
    fake.queue("sendMessage", { status: 500 }, 10);
    const sources = [source(candidate())];
    for (let index = 0; index < 5; index++) {
      await tick(sources, { now: new Date(NOW.getTime() + index * 15 * 60_000) });
    }
    expect(sentMessages()).toHaveLength(3);
    expect(await deliveries()).toMatchObject([
      { status: "failed", attempts: 3, errorCode: "telegram_server" },
    ]);
  });

  test("a retry that works settles it as sent, after 2 attempts", async () => {
    fake.queue("sendMessage", { status: 500 }, 1);
    const sources = [source(candidate())];
    await tick(sources);
    expect(await deliveries()).toMatchObject([{ status: "failed", attempts: 1 }]);
    const retry = await tick(sources, { now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(retry.sent).toBe(1);
    expect(await deliveries()).toMatchObject([{ status: "sent", attempts: 2, errorCode: null }]);
    await tick(sources, { now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(sentMessages()).toHaveLength(2);
  });

  test("two ticks at once on a failed reminder retry it once (the UPDATE re-checks under the lock)", async () => {
    fake.queue("sendMessage", { status: 500 }, 1);
    const { channel, sent } = slowChannel();
    await tick([source(candidate())]); // attempt 1 fails
    await Promise.all([
      tick([source(candidate())], {
        now: new Date(NOW.getTime() + 15 * 60_000),
        channels: { telegram: channel },
      }),
      tick([source(candidate())], {
        now: new Date(NOW.getTime() + 15 * 60_000),
        channels: { telegram: channel },
      }),
    ]);
    expect(sent).toHaveLength(1);
    expect(await deliveries()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  test("403 disconnects the chat, says why, and the reminder is never retried", async () => {
    fake.queue("sendMessage", { status: 403 }, 10);
    const summary = await tick([source(candidate())]);
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect(await deliveries()).toMatchObject([{ status: "failed", errorCode: "unreachable" }]);

    const settings = await getSettings(testDb);
    expect(settings.telegramChatId).toBeNull();
    expect(settings.linkedAt).toBeNull();
    expect(settings.telegramBlockedAt).toEqual(NOW);

    // Reconnecting does not resurrect the failed reminder either.
    await connectTelegram();
    await tick([source(candidate())], { now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(sentMessages()).toHaveLength(1);
  });

  test("403 also closes the live link codes (a disconnect is a clean slate)", async () => {
    await testDb
      .insert(telegramLinkCodes)
      .values({ codeHash: "c".repeat(64), expiresAt: new Date(NOW.getTime() + 60_000) });
    fake.queue("sendMessage", { status: 403 });
    await tick([source(candidate())]);
    const [code] = await testDb.select().from(telegramLinkCodes);
    expect(code.usedAt).not.toBeNull();
  });

  test("a reminder that fails does not block the next one", async () => {
    fake.queue("sendMessage", { status: 500 }, 1);
    const second = candidate({
      dedupeKey: "briefing:2026-10-09",
      dueAt: limaInstant("2026-10-08", "07:00"),
    });
    const summary = await tick([source(candidate(), second)]);
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
  });
});

describe("channels", () => {
  test("nothing connected: nothing is asked and nothing is sent", async () => {
    await testDb.update(reminderSettings).set({ telegramChatId: null, linkedAt: null });
    let asked = false;
    const summary = await tick(
      [{ id: "spy", candidates: async () => ((asked = true), [candidate()]) }],
      { channels: {} },
    );
    expect(summary.status).toBe("no-channel");
    expect(asked).toBe(false);
    expect(await deliveries()).toEqual([]);
  });

  test("the default (push) falls back to Telegram while no device is subscribed", async () => {
    expect((await getSettings(testDb)).deliveryChannel).toBe("push");
    await tick([source(candidate())]);
    expect(sentMessages()).toHaveLength(1);
  });

  test("a revoked subscription does not count as a device; a live one does", async () => {
    await testDb.insert(pushSubscriptions).values({
      endpoint: "https://push.example.test/revoked",
      p256dh: "k",
      auth: "a",
      revokedAt: new Date(),
    });
    await tick([source(candidate())]);
    expect(sentMessages()).toHaveLength(1); // still the Telegram fallback

    fake.reset();
    await testDb.delete(reminderDeliveries);
    await testDb
      .insert(pushSubscriptions)
      .values({ endpoint: "https://push.example.test/live", p256dh: "k", auth: "a" });
    // A live device and push chosen: push is the channel, and R1 has no push implementation, so
    // nothing goes out through Telegram (R5 adds the channel).
    const summary = await tick([source(candidate())]);
    expect(summary.status).toBe("no-channel");
    expect(sentMessages()).toHaveLength(0);
  });

  test("a delivery row per channel: both → push and Telegram, each on its own", async () => {
    await testDb.update(reminderSettings).set({ deliveryChannel: "both" });
    await testDb
      .insert(pushSubscriptions)
      .values({ endpoint: "https://push.example.test/live", p256dh: "k", auth: "a" });
    const pushed: string[] = [];
    const push: ReminderChannel = {
      id: "push",
      send: async (message): Promise<ChannelSendResult> => {
        pushed.push(message.dedupeKey);
        return { ok: false, code: "push_gone" };
      },
    };
    const summary = await tick([source(candidate())], {
      channels: { push, telegram: telegramChannel() },
    });
    // Push failed, Telegram was still sent.
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
    expect(pushed).toEqual(["briefing:2026-10-08"]);
    const rows = await testDb
      .select()
      .from(reminderDeliveries)
      .where(and(eq(reminderDeliveries.dedupeKey, "briefing:2026-10-08")))
      .orderBy(reminderDeliveries.channel);
    expect(rows.map((row) => [row.channel, row.status])).toEqual([
      ["push", "failed"],
      ["telegram", "sent"],
    ]);
  });
});
