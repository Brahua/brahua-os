// reminders → engine.ts with a fixed clock, fake sources and channels, and an in-memory delivery
// log (the claim against real Postgres is in tests/integration/reminders-engine.test.ts).
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  ChannelSendResult,
  ReminderCandidate,
  ReminderChannel,
  ReminderContext,
  ReminderSource,
} from "@/modules/reminders/contracts";
import type { ReminderSettings } from "@/modules/reminders/db/schema";
import { runTick } from "@/modules/reminders/engine";
import type { ChannelId, ReminderKind } from "@/modules/reminders/reminders-constants";
import { limaInstant } from "@/modules/reminders/slots";

type Row = {
  id: string;
  key: string;
  channel: ChannelId;
  status: "pending" | "sent" | "skipped" | "failed";
  attempts: number;
  errorCode: string | null;
};
const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  pushDevices: 0,
  rows: [] as Row[],
  disconnects: [] as string[],
}));

vi.mock("@/modules/reminders/settings", () => ({
  getSettings: async () => store.settings,
  countActivePushDevices: async () => store.pushDevices,
  disconnectTelegram: async (_db: unknown, reason: string) => {
    store.disconnects.push(reason);
  },
}));

vi.mock("@/modules/reminders/deliveries", () => {
  const find = (key: string, channel: string) =>
    store.rows.find((row) => row.key === key && row.channel === channel);
  return {
    claimDelivery: async (_db: unknown, target: { dedupeKey: string; channel: ChannelId }) => {
      const existing = find(target.dedupeKey, target.channel);
      if (!existing) {
        const row: Row = {
          id: `row-${store.rows.length + 1}`,
          key: target.dedupeKey,
          channel: target.channel,
          status: "pending",
          attempts: 1,
          errorCode: null,
        };
        store.rows.push(row);
        return row.id;
      }
      if (
        existing.status === "failed" &&
        existing.attempts < 3 &&
        existing.errorCode !== "unreachable"
      ) {
        existing.status = "pending";
        existing.attempts++;
        return existing.id;
      }
      return null;
    },
    recordSkipped: async (
      _db: unknown,
      target: { dedupeKey: string; channel: ChannelId },
      errorCode: string,
    ) => {
      if (find(target.dedupeKey, target.channel)) return false;
      store.rows.push({
        id: `row-${store.rows.length + 1}`,
        key: target.dedupeKey,
        channel: target.channel,
        status: "skipped",
        attempts: 0,
        errorCode,
      });
      return true;
    },
    markSkipped: async (_db: unknown, id: string, errorCode: string) => {
      Object.assign(
        store.rows.find((row) => row.id === id)!,
        { status: "skipped", errorCode },
      );
    },
    markSent: async (_db: unknown, id: string) => {
      Object.assign(
        store.rows.find((row) => row.id === id)!,
        { status: "sent", errorCode: null },
      );
    },
    markFailed: async (_db: unknown, id: string, errorCode: string) => {
      Object.assign(
        store.rows.find((row) => row.id === id)!,
        { status: "failed", errorCode },
      );
    },
  };
});

vi.mock("@/modules/reminders/log", () => ({ logEvent: vi.fn() }));

const NOW = limaInstant("2026-10-08", "07:35"); // 5 minutes after the briefing time
const DB = {} as never;

function settings(overrides: Partial<ReminderSettings> = {}): ReminderSettings {
  return {
    id: true,
    deliveryChannel: "telegram",
    briefingEnabled: true,
    briefingTime: "07:30:00",
    paymentsEnabled: true,
    eveningEnabled: true,
    eveningTime: "21:00:00",
    habitTimesEnabled: true,
    showAmountsTelegram: true,
    showAmountsPush: false,
    telegramChatId: 42,
    linkedAt: new Date("2026-10-01T12:00:00Z"),
    telegramBlockedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function candidate(
  overrides: Partial<Omit<ReminderCandidate, "build">> & {
    text?: string | null;
    build?: ReminderCandidate["build"];
  } = {},
): ReminderCandidate {
  const { text = "Buen día.", build, ...rest } = overrides;
  return {
    kind: "briefing" as ReminderKind,
    dedupeKey: "briefing:2026-10-08",
    dueAt: limaInstant("2026-10-08", "07:30"),
    build: build ?? (async () => text),
    ...rest,
  };
}

const source = (...candidates: ReminderCandidate[]): ReminderSource => ({
  id: "test",
  candidates: async () => candidates,
});

function fakeChannel(
  id: ChannelId,
  result: ChannelSendResult | (() => ChannelSendResult) = { ok: true, messageId: 7 },
) {
  const sent: { text: string; dedupeKey: string }[] = [];
  const channel: ReminderChannel = {
    id,
    send: async (message) => {
      sent.push(message);
      return typeof result === "function" ? result() : result;
    },
  };
  return { channel, sent };
}

function tick(
  sources: ReminderSource[],
  channels: Partial<Record<ChannelId, ReminderChannel>>,
  now = NOW,
) {
  return runTick({ db: DB, now, sources, channelsFor: () => channels });
}

beforeEach(() => {
  store.settings = settings();
  store.pushDevices = 0;
  store.rows = [];
  store.disconnects = [];
});

describe("a tick", () => {
  test("sends a due reminder once, through the channel, with the keyed message", async () => {
    const telegram = fakeChannel("telegram");
    const summary = await tick([source(candidate())], { telegram: telegram.channel });
    expect(summary).toEqual({ status: "ok", candidates: 1, sent: 1, skipped: 0, failed: 0 });
    expect(telegram.sent).toEqual([{ text: "Buen día.", dedupeKey: "briefing:2026-10-08" }]);
    expect(store.rows).toMatchObject([{ channel: "telegram", status: "sent", attempts: 1 }]);
  });

  test("running the same tick again sends nothing more (the claim holds)", async () => {
    const telegram = fakeChannel("telegram");
    const sources = [source(candidate())];
    await tick(sources, { telegram: telegram.channel });
    const again = await tick(
      sources,
      { telegram: telegram.channel },
      new Date(NOW.getTime() + 15 * 60_000),
    );
    expect(telegram.sent).toHaveLength(1);
    expect(again).toMatchObject({ sent: 0, failed: 0 });
  });

  test("passes the context: the Lima day and the configured times", async () => {
    store.settings = settings({ briefingTime: "08:15:00", eveningTime: "20:45:00" });
    const seen: ReminderContext[] = [];
    await tick([{ id: "spy", candidates: async (context) => (seen.push(context), []) }], {
      telegram: fakeChannel("telegram").channel,
    });
    expect(seen).toEqual([
      { now: NOW, today: "2026-10-08", times: { briefing: "08:15", evening: "20:45" } },
    ]);
  });

  test("a reminder that is not due yet is left alone (no row)", async () => {
    const later = candidate({
      dueAt: limaInstant("2026-10-08", "21:00"),
      dedupeKey: "evening:2026-10-08",
    });
    const telegram = fakeChannel("telegram");
    await tick([source(later)], { telegram: telegram.channel });
    expect(telegram.sent).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  test("the window is [due, due + 2 h): open at 09:29, skipped from 09:30", async () => {
    const telegram = fakeChannel("telegram");
    await tick(
      [source(candidate())],
      { telegram: telegram.channel },
      limaInstant("2026-10-08", "09:29"),
    );
    expect(telegram.sent).toHaveLength(1);

    store.rows = [];
    const late = fakeChannel("telegram");
    const summary = await tick(
      [source(candidate())],
      { telegram: late.channel },
      limaInstant("2026-10-08", "09:30"),
    );
    expect(late.sent).toHaveLength(0);
    expect(summary.skipped).toBe(1);
    expect(store.rows).toMatchObject([{ status: "skipped", errorCode: "window_expired" }]);
  });

  test("an expired window is recorded once, not on every tick", async () => {
    const telegram = fakeChannel("telegram");
    const afternoon = limaInstant("2026-10-08", "14:00");
    await tick([source(candidate())], { telegram: telegram.channel }, afternoon);
    const second = await tick([source(candidate())], { telegram: telegram.channel }, afternoon);
    expect(store.rows).toHaveLength(1);
    expect(second.skipped).toBe(0);
  });

  test("a switched-off kind is ignored (nothing recorded)", async () => {
    store.settings = settings({ briefingEnabled: false });
    const telegram = fakeChannel("telegram");
    await tick([source(candidate())], { telegram: telegram.channel });
    expect(telegram.sent).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  test("nothing to say: the claim is kept as skipped, nothing is sent", async () => {
    const telegram = fakeChannel("telegram");
    for (const text of [null, "", "   "]) {
      store.rows = [];
      const summary = await tick([source(candidate({ text }))], { telegram: telegram.channel });
      expect(summary).toMatchObject({ sent: 0, skipped: 1 });
      expect(store.rows).toMatchObject([{ status: "skipped", errorCode: "empty" }]);
    }
    expect(telegram.sent).toHaveLength(0);
  });

  test("build gets the channel and that channel's amounts switch", async () => {
    store.settings = settings({
      deliveryChannel: "both",
      showAmountsTelegram: true,
      showAmountsPush: false,
    });
    store.pushDevices = 1;
    const options: { channel: string; showAmounts: boolean }[] = [];
    const spy = candidate({
      build: async (option) => (options.push(option), `texto ${option.channel}`),
    });
    const telegram = fakeChannel("telegram");
    const push = fakeChannel("push");
    await tick([source(spy)], { telegram: telegram.channel, push: push.channel });
    expect(options).toEqual([
      { channel: "push", showAmounts: false },
      { channel: "telegram", showAmounts: true },
    ]);
  });
});

describe("channels", () => {
  test("nothing connected: no work at all, sources are not even asked", async () => {
    store.settings = settings({ telegramChatId: null, linkedAt: null });
    const candidates = vi.fn(async () => [candidate()]);
    const summary = await tick([{ id: "x", candidates }], {});
    expect(summary).toEqual({
      status: "no-channel",
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(candidates).not.toHaveBeenCalled();
  });

  test("push by default, but with no device the reminder goes through Telegram", async () => {
    store.settings = settings({ deliveryChannel: "push" });
    const telegram = fakeChannel("telegram");
    await tick([source(candidate())], { telegram: telegram.channel });
    expect(telegram.sent).toHaveLength(1);
  });

  test("push chosen with a device but no push implementation yet: nothing sent, nothing lost on Telegram", async () => {
    store.settings = settings({ deliveryChannel: "push" });
    store.pushDevices = 1;
    const telegram = fakeChannel("telegram");
    const summary = await tick([source(candidate())], { telegram: telegram.channel });
    expect(summary.status).toBe("no-channel");
    expect(telegram.sent).toHaveLength(0);
  });

  test("both: one row per channel, and a channel that fails does not block the other", async () => {
    store.settings = settings({ deliveryChannel: "both" });
    store.pushDevices = 1;
    const push = fakeChannel("push", { ok: false, code: "push_server" });
    const telegram = fakeChannel("telegram");
    const summary = await tick([source(candidate())], {
      push: push.channel,
      telegram: telegram.channel,
    });
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
    expect(store.rows.map((row) => [row.channel, row.status])).toEqual([
      ["push", "failed"],
      ["telegram", "sent"],
    ]);
  });
});

describe("failures", () => {
  test("a failed send is retried on the next tick, at most 3 attempts in total", async () => {
    const telegram = fakeChannel("telegram", { ok: false, code: "telegram_server" });
    const sources = [source(candidate())];
    for (let index = 0; index < 5; index++) {
      await tick(
        sources,
        { telegram: telegram.channel },
        new Date(NOW.getTime() + index * 15 * 60_000),
      );
    }
    expect(telegram.sent).toHaveLength(3);
    expect(store.rows).toMatchObject([
      { status: "failed", attempts: 3, errorCode: "telegram_server" },
    ]);
  });

  test("a retry that works settles the reminder as sent", async () => {
    let fail = true;
    const telegram = fakeChannel("telegram", () =>
      fail ? { ok: false, code: "telegram_network" } : { ok: true, messageId: 9 },
    );
    const sources = [source(candidate())];
    await tick(sources, { telegram: telegram.channel });
    fail = false;
    const retried = await tick(
      sources,
      { telegram: telegram.channel },
      new Date(NOW.getTime() + 15 * 60_000),
    );
    expect(retried.sent).toBe(1);
    expect(store.rows).toMatchObject([{ status: "sent", attempts: 2 }]);
    // And it does not go out a third time.
    await tick(sources, { telegram: telegram.channel }, new Date(NOW.getTime() + 30 * 60_000));
    expect(telegram.sent).toHaveLength(2);
  });

  test("a retry is not made once the window has closed", async () => {
    const telegram = fakeChannel("telegram", { ok: false, code: "telegram_server" });
    const sources = [source(candidate())];
    await tick(sources, { telegram: telegram.channel });
    await tick(sources, { telegram: telegram.channel }, limaInstant("2026-10-08", "10:00"));
    expect(telegram.sent).toHaveLength(1);
  });

  test("403 disconnects the chat, is never retried and stops using that channel", async () => {
    const blocked = fakeChannel("telegram", { ok: false, code: "unreachable", unreachable: true });
    const second = candidate({
      dedupeKey: "briefing:2026-10-09",
      dueAt: limaInstant("2026-10-08", "07:00"),
    });
    const sources = [source(candidate(), second)];
    const summary = await tick(sources, { telegram: blocked.channel });
    // The second candidate never tried: the channel left the tick.
    expect(blocked.sent).toHaveLength(1);
    expect(summary.failed).toBe(1);
    expect(store.disconnects).toEqual(["blocked"]);
    expect(store.rows).toMatchObject([{ status: "failed", errorCode: "unreachable" }]);

    // A later tick (the fake still lists the chat as connected) does not retry the unreachable
    // one: only the candidate that never tried gets its first attempt.
    await tick(sources, { telegram: blocked.channel }, new Date(NOW.getTime() + 15 * 60_000));
    expect(blocked.sent).toHaveLength(2);
    expect(store.rows.find((row) => row.key === "briefing:2026-10-08")?.attempts).toBe(1);
  });

  test("a channel that throws is recorded as failed and the tick goes on", async () => {
    const throwing: ReminderChannel = {
      id: "telegram",
      send: async () => {
        throw new Error("boom with a secret: 123456:TOKEN");
      },
    };
    const summary = await tick(
      [
        source(
          candidate(),
          candidate({
            kind: "evening_review",
            dedupeKey: "evening:2026-10-07",
            dueAt: limaInstant("2026-10-08", "06:00"),
          }),
        ),
      ],
      { telegram: throwing },
    );
    expect(summary.failed).toBe(2);
    expect(store.rows.map((row) => row.errorCode)).toEqual(["send_threw", "send_threw"]);
  });

  test("a candidate whose build throws is failed; the next candidate is still sent", async () => {
    const telegram = fakeChannel("telegram");
    const broken = candidate({
      dedupeKey: "briefing:broken",
      build: async () => {
        throw new Error("nope");
      },
    });
    const fine = candidate({ dedupeKey: "briefing:fine" });
    const summary = await tick([source(broken, fine)], { telegram: telegram.channel });
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
    expect(store.rows.find((row) => row.key === "briefing:broken")?.errorCode).toBe("build_failed");
  });

  test("a source that throws does not stop the others", async () => {
    const telegram = fakeChannel("telegram");
    const bad: ReminderSource = {
      id: "bad",
      candidates: async () => {
        throw new Error("db down");
      },
    };
    const summary = await tick([bad, source(candidate())], { telegram: telegram.channel });
    expect(summary.sent).toBe(1);
  });
});
