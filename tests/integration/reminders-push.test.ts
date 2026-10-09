// @vitest-environment node
// R5 of `reminders` against Postgres: push subscriptions (save, reactivate, cap, revoke), the
// Server Actions of Ajustes (owner first, strict input, the endpoint allowlist), and the engine
// with the push channel over the real store and a simulated push service: a device per delivery,
// a 410 revokes and the next tick falls back to Telegram, one channel failing never blocks the other.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import {
  getPushDeviceState,
  setDeliveryChannel,
  subscribePushDevice,
  unsubscribePushDevice,
  updateReminderSettings,
} from "@/modules/reminders/actions";
import { createWebPushChannel } from "@/modules/reminders/channels/web-push/channel";
import type { PushResult, WebPushClient } from "@/modules/reminders/channels/web-push/client";
import type {
  ReminderCandidate,
  ReminderChannel,
  ReminderSource,
} from "@/modules/reminders/contracts";
import {
  pushSubscriptions,
  reminderDeliveries,
  reminderSettings,
} from "@/modules/reminders/db/schema";
import { runTick } from "@/modules/reminders/engine";
import { CHANNEL_COPY } from "@/modules/reminders/channel-copy";
import {
  createPushDeviceStore,
  savePushSubscription,
} from "@/modules/reminders/push/subscriptions";
import { PUSH_MAX_DEVICES } from "@/modules/reminders/reminders-constants";
import { getSettings, readChannelSummary } from "@/modules/reminders/settings";
import { limaInstant } from "@/modules/reminders/slots";
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
afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

// Shaped like real ones (the actions validate length and alphabet, not that the point exists).
const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "B".padEnd(87, "x"),
  VAPID_PRIVATE_KEY: "k".repeat(43),
  VAPID_SUBJECT: "mailto:owner@example.com",
};
const KEYS = { p256dh: "B".padEnd(87, "p"), auth: "a".repeat(22) };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const endpointOf = (id: string) => `https://web.push.apple.com/${id}`;
const subscription = (id: string) => ({ endpoint: endpointOf(id), keys: KEYS });

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  process.env = { ...ORIGINAL_ENV, ...AUTH_ENV, ...VAPID_ENV };
  request.headers = new Headers({
    cookie: await sessionCookieFor(OWNER),
    "user-agent": IPHONE_UA,
  });
});

const rows = () => testDb.select().from(pushSubscriptions).orderBy(pushSubscriptions.endpoint);

describe("savePushSubscription", () => {
  test("stores the subscription with its user agent", async () => {
    expect(await savePushSubscription(testDb, subscription("a"), IPHONE_UA)).toBe("saved");
    const [row] = await rows();
    expect(row).toMatchObject({
      endpoint: endpointOf("a"),
      p256dh: KEYS.p256dh,
      auth: KEYS.auth,
      userAgent: IPHONE_UA,
      revokedAt: null,
      lastSuccessAt: null,
    });
  });

  test("a user agent longer than the column allows is cut, not refused", async () => {
    await savePushSubscription(testDb, subscription("a"), "x".repeat(500));
    expect((await rows())[0].userAgent).toHaveLength(200);
  });

  test("the same endpoint is one row: subscribing again takes the new keys and reactivates it", async () => {
    await savePushSubscription(testDb, subscription("a"), "old");
    await testDb.update(pushSubscriptions).set({ revokedAt: new Date() });
    const newKeys = { p256dh: "B".padEnd(87, "q"), auth: "b".repeat(22) };
    await savePushSubscription(testDb, { endpoint: endpointOf("a"), keys: newKeys }, "new");
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      p256dh: newKeys.p256dh,
      auth: newKeys.auth,
      userAgent: "new",
      revokedAt: null,
    });
  });

  test(`at most ${PUSH_MAX_DEVICES} active devices; a known one can always resubscribe; a revoked one frees a place`, async () => {
    for (let index = 0; index < PUSH_MAX_DEVICES; index++) {
      expect(await savePushSubscription(testDb, subscription(`d${index}`), null)).toBe("saved");
    }
    expect(await savePushSubscription(testDb, subscription("extra"), null)).toBe(
      "too_many_devices",
    );
    expect(await rows()).toHaveLength(PUSH_MAX_DEVICES);
    // Positive control: the same cap lets a known endpoint in again.
    expect(await savePushSubscription(testDb, subscription("d0"), null)).toBe("saved");
    // And a revoked device frees a place.
    await testDb
      .update(pushSubscriptions)
      .set({ revokedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpointOf("d1")));
    expect(await savePushSubscription(testDb, subscription("extra"), null)).toBe("saved");
  });
});

describe("the actions", () => {
  test("without the owner nothing is read or written, and the input is not even looked at", async () => {
    for (const cookie of ["", await sessionCookieFor(OTHER)]) {
      request.headers = new Headers({ cookie });
      expect(await subscribePushDevice(subscription("a"))).toEqual({
        ok: false,
        error: UNAUTHORIZED_MESSAGE,
      });
      expect(await unsubscribePushDevice({ endpoint: endpointOf("a") })).toEqual({
        ok: false,
        error: UNAUTHORIZED_MESSAGE,
      });
      expect(await getPushDeviceState({ endpoint: endpointOf("a") })).toEqual({
        ok: false,
        error: UNAUTHORIZED_MESSAGE,
      });
      expect(await setDeliveryChannel({ deliveryChannel: "both" })).toEqual({
        ok: false,
        error: UNAUTHORIZED_MESSAGE,
      });
    }
    expect(await rows()).toEqual([]);
    expect((await getSettings(testDb)).deliveryChannel).toBe("push");
  });

  test("subscribing records the device with the REQUEST's user agent and returns a summary with no endpoint or key", async () => {
    const result = await subscribePushDevice(subscription("a"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await rows())[0].userAgent).toBe(IPHONE_UA);
    expect(result.data.devices).toHaveLength(1);
    expect(result.data.devices[0].label).toBe("iPhone · Safari");
    const text = JSON.stringify(result);
    expect(text).not.toContain(endpointOf("a"));
    expect(text).not.toContain(KEYS.p256dh);
    expect(text).not.toContain(KEYS.auth);
    expect(text).not.toContain(VAPID_ENV.VAPID_PRIVATE_KEY);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/reminders");
  });

  test("a user agent sent by the client is ignored (the field does not exist in the schema)", async () => {
    const result = await subscribePushDevice({ ...subscription("a"), userAgent: "forged" });
    expect(result.ok).toBe(false);
    expect(await rows()).toEqual([]);
  });

  test("without the VAPID variables it says push is not configured and stores nothing", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await subscribePushDevice(subscription("a"))).toEqual({
      ok: false,
      error: CHANNEL_COPY.device.notConfigured,
    });
    expect(await rows()).toEqual([]);
  });

  test("an endpoint outside the push services is refused and nothing is stored", async () => {
    for (const endpoint of [
      "https://evil.example.com/collect",
      "http://web.push.apple.com/x",
      "https://169.254.169.254/latest",
      "https://localhost:3000/x",
    ]) {
      const result = await subscribePushDevice({ endpoint, keys: KEYS });
      expect(result.ok, endpoint).toBe(false);
    }
    expect(await rows()).toEqual([]);
  });

  test("malformed keys and unknown fields are refused", async () => {
    for (const input of [
      { endpoint: endpointOf("a"), keys: { p256dh: "short", auth: KEYS.auth } },
      { endpoint: endpointOf("a"), keys: { p256dh: KEYS.p256dh } },
      { endpoint: endpointOf("a"), keys: KEYS, id: "x" },
      { endpoint: endpointOf("a") },
      null,
      "x",
    ]) {
      expect((await subscribePushDevice(input)).ok).toBe(false);
    }
    expect(await rows()).toEqual([]);
  });

  test("the cap shows as a message, not a crash", async () => {
    for (let index = 0; index < PUSH_MAX_DEVICES; index++) {
      await savePushSubscription(testDb, subscription(`d${index}`), null);
    }
    expect(await subscribePushDevice(subscription("extra"))).toEqual({
      ok: false,
      error: CHANNEL_COPY.device.tooMany,
    });
  });

  test("unsubscribing revokes the row (kept, not deleted) and the device leaves the summary", async () => {
    await subscribePushDevice(subscription("a"));
    const result = await unsubscribePushDevice({ endpoint: endpointOf("a") });
    expect(result).toMatchObject({ ok: true, data: { devices: [] } });
    const [row] = await rows();
    expect(row.revokedAt).not.toBeNull();
    // Unsubscribing something unknown is not an error: the device is not receiving anything either way.
    expect((await unsubscribePushDevice({ endpoint: endpointOf("unknown") })).ok).toBe(true);
  });

  test("getPushDeviceState says whether the server sends to that endpoint", async () => {
    expect(await getPushDeviceState({ endpoint: endpointOf("a") })).toEqual({
      ok: true,
      data: { active: false },
    });
    await subscribePushDevice(subscription("a"));
    expect(await getPushDeviceState({ endpoint: endpointOf("a") })).toEqual({
      ok: true,
      data: { active: true },
    });
    await unsubscribePushDevice({ endpoint: endpointOf("a") });
    expect(await getPushDeviceState({ endpoint: endpointOf("a") })).toEqual({
      ok: true,
      data: { active: false },
    });
  });

  test("Canal de avisos saves each choice and refuses anything else", async () => {
    for (const deliveryChannel of ["telegram", "both", "push"] as const) {
      expect(await setDeliveryChannel({ deliveryChannel })).toMatchObject({
        ok: true,
        data: { deliveryChannel },
      });
      expect((await getSettings(testDb)).deliveryChannel).toBe(deliveryChannel);
    }
    expect((await setDeliveryChannel({ deliveryChannel: "email" })).ok).toBe(false);
    expect((await setDeliveryChannel({ deliveryChannel: "push", telegramChatId: 1 })).ok).toBe(
      false,
    );
    expect((await getSettings(testDb)).deliveryChannel).toBe("push");
  });

  test("the schedule action saves the push amounts switch, off by default, and cannot touch the channel", async () => {
    expect((await getSettings(testDb)).showAmountsPush).toBe(false);
    expect(await updateReminderSettings({ showAmountsPush: true })).toMatchObject({
      ok: true,
      data: { showAmountsPush: true },
    });
    expect((await getSettings(testDb)).showAmountsPush).toBe(true);
    expect((await updateReminderSettings({ deliveryChannel: "both" })).ok).toBe(false);
    expect((await getSettings(testDb)).deliveryChannel).toBe("push");
  });
});

describe("readChannelSummary", () => {
  test("a fresh install reads as push, no devices, with the keys as the environment has them", async () => {
    expect(await readChannelSummary(testDb)).toEqual({
      deliveryChannel: "push",
      pushConfigured: true,
      pushProblems: [],
      vapidPublicKey: VAPID_ENV.VAPID_PUBLIC_KEY,
      devices: [],
      telegramConnected: false,
    });
    // Read only: a page load must not create the settings row.
    expect(await testDb.select().from(reminderSettings)).toEqual([]);
  });

  test("with the variables absent push is not configured, by variable name, and has no key", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_SUBJECT;
    expect(await readChannelSummary(testDb)).toMatchObject({
      pushConfigured: false,
      vapidPublicKey: null,
      pushProblems: ["VAPID_PUBLIC_KEY falta", "VAPID_SUBJECT falta"],
    });
  });

  test("lists active devices, oldest first, and leaves revoked ones out", async () => {
    await savePushSubscription(testDb, subscription("a"), IPHONE_UA);
    await savePushSubscription(testDb, subscription("b"), "Mozilla/5.0 (X11; Linux) Firefox/127.0");
    await savePushSubscription(testDb, subscription("gone"), null);
    await testDb
      .update(pushSubscriptions)
      .set({ revokedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpointOf("gone")));
    const summary = await readChannelSummary(testDb);
    expect(summary.devices.map((device) => device.label)).toEqual([
      "iPhone · Safari",
      "Linux · Firefox",
    ]);
  });
});

// ---- the engine with the push channel -------------------------------------------------------

const CHAT_ID = 5_000_000_042;
const DUE = limaInstant("2026-10-08", "07:30");
const NOW = new Date(DUE.getTime() + 5 * 60_000);

/** A push service that answers per endpoint (the last path segment) and remembers every call. */
function fakePushService(answers: Record<string, PushResult> = {}) {
  const calls: { endpoint: string; payload: string }[] = [];
  const client: WebPushClient = {
    async send(target, payload) {
      calls.push({ endpoint: target.endpoint, payload });
      return answers[target.endpoint.split("/").pop()!] ?? { ok: true };
    },
  };
  return { client, calls, answers };
}

function pushChannel(client: WebPushClient): ReminderChannel {
  return createWebPushChannel({ store: createPushDeviceStore(testDb), client });
}

function telegramSpy() {
  const sent: string[] = [];
  const channel: ReminderChannel = {
    id: "telegram",
    send: async (message) => {
      sent.push(message.text);
      return { ok: true, messageId: sent.length };
    },
  };
  return { channel, sent };
}

function briefing(
  build: ReminderCandidate["build"] = async () => "Buen día.",
  dedupeKey = "briefing:2026-10-08",
): ReminderSource {
  return {
    id: "test",
    candidates: async () => [{ kind: "briefing", dedupeKey, dueAt: DUE, build }],
  };
}

const tick = (
  sources: ReminderSource[],
  channels: Partial<Record<"push" | "telegram", ReminderChannel>>,
  now = NOW,
) => runTick({ db: testDb, now, sources, channelsFor: () => channels });

const deliveryRows = () =>
  testDb.select().from(reminderDeliveries).orderBy(reminderDeliveries.channel);

async function linkTelegram() {
  await getSettings(testDb);
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: CHAT_ID, linkedAt: new Date("2026-10-01T12:00:00Z") });
}

describe("the engine with push", () => {
  test("push (the default) with a device sends to the device and records a push delivery", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService();
    const telegram = telegramSpy();
    const summary = await tick([briefing()], {
      push: pushChannel(push.client),
      telegram: telegram.channel,
    });
    expect(summary).toMatchObject({ status: "ok", sent: 1, failed: 0 });
    expect(push.calls).toHaveLength(1);
    expect(JSON.parse(push.calls[0].payload)).toEqual({
      title: "brahua-os",
      body: "Buen día.",
      tag: "briefing:2026-10-08",
    });
    expect(telegram.sent).toEqual([]);
    expect(await deliveryRows()).toMatchObject([
      { channel: "push", status: "sent", attempts: 1, errorCode: null, telegramMessageId: null },
    ]);
    // The success is remembered on the device.
    expect((await rows())[0].lastSuccessAt).not.toBeNull();
  });

  test("with no device it falls back to Telegram, and a device later takes over", async () => {
    await linkTelegram();
    const push = fakePushService();
    const telegram = telegramSpy();
    const channels = { push: pushChannel(push.client), telegram: telegram.channel };

    await tick([briefing()], channels);
    expect(push.calls).toHaveLength(0);
    expect(telegram.sent).toEqual(["Buen día."]);

    await savePushSubscription(testDb, subscription("a"), null);
    await tick([briefing(async () => "Otro.", "briefing:2026-10-09")], channels, NOW);
    expect(push.calls).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  test("without VAPID (no push channel at all) a device row changes nothing: Telegram sends", async () => {
    await linkTelegram();
    await savePushSubscription(testDb, subscription("a"), null);
    const telegram = telegramSpy();
    const summary = await tick([briefing()], { telegram: telegram.channel });
    expect(summary).toMatchObject({ status: "ok", sent: 1 });
    expect(telegram.sent).toEqual(["Buen día."]);
  });

  test("a 410 revokes the device, fails that delivery, and the next reminder falls back to Telegram", async () => {
    await linkTelegram();
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService({ a: { ok: false, kind: "gone" } });
    const telegram = telegramSpy();
    const channels = { push: pushChannel(push.client), telegram: telegram.channel };

    const first = await tick([briefing()], channels);
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect((await rows())[0].revokedAt).not.toBeNull();
    expect(await deliveryRows()).toMatchObject([
      { channel: "push", status: "failed", errorCode: "unreachable" },
    ]);
    // Push is never retried (its subscription is gone), but with no live device left the next
    // tick, still inside the window, delivers the same reminder through Telegram: it is not lost.
    await tick([briefing()], channels, new Date(NOW.getTime() + 15 * 60_000));
    expect(push.calls).toHaveLength(1);
    expect(telegram.sent).toEqual(["Buen día."]);

    // And the next reminder goes straight to Telegram.
    await tick([briefing(async () => "Siguiente.", "briefing:2026-10-09")], channels);
    expect(push.calls).toHaveLength(1);
    expect(telegram.sent).toEqual(["Buen día.", "Siguiente."]);
  });

  test("both: a device and Telegram each get it, with a delivery row each; one failing never blocks the other", async () => {
    await testDb.insert(reminderSettings).values({ deliveryChannel: "both" });
    await linkTelegram();
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService({ a: { ok: false, kind: "server" } });
    const telegram = telegramSpy();
    const summary = await tick([briefing()], {
      push: pushChannel(push.client),
      telegram: telegram.channel,
    });
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
    expect(telegram.sent).toEqual(["Buen día."]);
    expect((await deliveryRows()).map((row) => [row.channel, row.status, row.errorCode])).toEqual([
      ["push", "failed", "push_server"],
      ["telegram", "sent", null],
    ]);
  });

  test("a clear failure (a 5xx) is retried by the next tick, up to three attempts", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService({ a: { ok: false, kind: "server" } });
    const channels = { push: pushChannel(push.client) };
    for (let index = 0; index < 5; index++) {
      await tick([briefing()], channels, new Date(NOW.getTime() + index * 15 * 60_000));
    }
    expect(push.calls).toHaveLength(3);
    expect(await deliveryRows()).toMatchObject([{ status: "failed", attempts: 3 }]);
  });

  test("an ambiguous failure (a timeout) is never retried: a duplicate is worse than a miss", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService({ a: { ok: false, kind: "network" } });
    const channels = { push: pushChannel(push.client) };
    await tick([briefing()], channels);
    await tick([briefing()], channels, new Date(NOW.getTime() + 15 * 60_000));
    await tick([briefing()], channels, new Date(NOW.getTime() + 30 * 60_000));
    expect(push.calls).toHaveLength(1);
    expect(await deliveryRows()).toMatchObject([{ status: "failed", errorCode: "push_network" }]);
  });

  test("two devices get one message each, and a rerun sends nothing more", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    await savePushSubscription(testDb, subscription("b"), null);
    const push = fakePushService();
    const channels = { push: pushChannel(push.client) };
    await tick([briefing()], channels);
    await tick([briefing()], channels, new Date(NOW.getTime() + 15 * 60_000));
    expect(push.calls.map((call) => call.endpoint).sort()).toEqual([
      endpointOf("a"),
      endpointOf("b"),
    ]);
    expect(await deliveryRows()).toHaveLength(1);
  });

  test("two ticks at the same time send ONE push per device (the claim), and two different reminders both go out", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    const push = fakePushService();
    const channels = { push: pushChannel(push.client) };
    await Promise.all([tick([briefing()], channels), tick([briefing()], channels)]);
    expect(push.calls).toHaveLength(1);
    // Positive control.
    await tick([briefing(async () => "Otro.", "briefing:2026-10-09")], channels);
    expect(push.calls).toHaveLength(2);
  });

  test("amounts: the push text is built with the push switch (off by default), Telegram with its own", async () => {
    await testDb.insert(reminderSettings).values({ deliveryChannel: "both" });
    await linkTelegram();
    await savePushSubscription(testDb, subscription("a"), null);
    const seen: { channel: string; showAmounts: boolean }[] = [];
    const build: ReminderCandidate["build"] = async (options) => {
      seen.push({ channel: options.channel, showAmounts: options.showAmounts });
      return options.showAmounts ? "Vence Luz S/ 80.00" : "Vence Luz";
    };
    const push = fakePushService();
    const telegram = telegramSpy();
    await tick([briefing(build)], { push: pushChannel(push.client), telegram: telegram.channel });
    expect(seen.sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      { channel: "push", showAmounts: false },
      { channel: "telegram", showAmounts: true },
    ]);
    expect(JSON.parse(push.calls[0].payload).body).toBe("Vence Luz");
    expect(telegram.sent).toEqual(["Vence Luz S/ 80.00"]);

    // With the push switch on, the same candidate carries amounts in push.
    await testDb.update(reminderSettings).set({ showAmountsPush: true });
    await tick([briefing(build, "briefing:2026-10-09")], {
      push: pushChannel(push.client),
      telegram: telegram.channel,
    });
    expect(JSON.parse(push.calls[1].payload).body).toBe("Vence Luz S/ 80.00");
  });

  test("a tick with a revoked device only and no Telegram does nothing", async () => {
    await savePushSubscription(testDb, subscription("a"), null);
    await testDb.update(pushSubscriptions).set({ revokedAt: new Date() });
    const push = fakePushService();
    const summary = await tick([briefing()], { push: pushChannel(push.client) });
    expect(summary.status).toBe("no-channel");
    expect(push.calls).toHaveLength(0);
    expect(
      await testDb.select().from(reminderDeliveries).where(eq(reminderDeliveries.channel, "push")),
    ).toEqual([]);
  });
});
