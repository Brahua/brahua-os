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
import {
  RETRYABLE_ERROR_CODES,
  type ChannelId,
  type ReminderKind,
} from "@/modules/reminders/reminders-constants";
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
  disconnectedChats: [] as (number | undefined)[],
}));

vi.mock("@/modules/reminders/settings", () => ({
  getSettings: async () => store.settings,
  countActivePushDevices: async () => store.pushDevices,
  disconnectTelegram: async (_db: unknown, reason: string, _now: Date, expectedChatId?: number) => {
    store.disconnects.push(reason);
    store.disconnectedChats.push(expectedChatId);
    return true;
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
        existing.errorCode !== null &&
        RETRYABLE_ERROR_CODES.includes(existing.errorCode)
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
  store.disconnectedChats = [];
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
    store.settings = settings({
      briefingTime: "08:15:00",
      eveningTime: "20:45:00",
      paymentsEnabled: false,
    });
    const seen: ReminderContext[] = [];
    await tick([{ id: "spy", candidates: async (context) => (seen.push(context), []) }], {
      telegram: fakeChannel("telegram").channel,
    });
    expect(seen).toEqual([
      {
        now: NOW,
        today: "2026-10-08",
        yesterday: "2026-10-07",
        times: { briefing: "08:15", evening: "20:45" },
        // Which kinds are on (here the payments are off), so a source can skip its queries.
        enabled: {
          briefing: true,
          payment_eve: false,
          payment_followup: false,
          evening_review: true,
          habit_time: true,
        },
      },
    ]);
  });

  // The Lima day is not the UTC day: from 19:00 to 23:59 Lima it is already the next day in UTC.
  test.each([
    [
      "22:30 on the 8th in Lima (03:30 UTC of the 9th)",
      limaInstant("2026-10-08", "22:30"),
      "2026-10-08",
      "2026-10-07",
    ],
    [
      "00:15 on the 9th in Lima (05:15 UTC of the 9th)",
      limaInstant("2026-10-09", "00:15"),
      "2026-10-09",
      "2026-10-08",
    ],
    [
      "23:59 on the 31st in Lima (04:59 UTC of the 1st)",
      limaInstant("2026-10-31", "23:59"),
      "2026-10-31",
      "2026-10-30",
    ],
    ["00:00 on Jan 1st in Lima", limaInstant("2027-01-01", "00:00"), "2027-01-01", "2026-12-31"],
  ])("today and yesterday are the owner's days at %s", async (_label, now, today, yesterday) => {
    const seen: ReminderContext[] = [];
    await tick(
      [{ id: "spy", candidates: async (context) => (seen.push(context), []) }],
      { telegram: fakeChannel("telegram").channel },
      now,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ now, today, yesterday });
  });

  test("a reminder of yesterday at 23:30 is still open at 00:30 today (the window crosses midnight)", async () => {
    const telegram = fakeChannel("telegram");
    const lateHabit = candidate({
      kind: "habit_time",
      dedupeKey: "habit_time:leer:2026-10-08",
      dueAt: limaInstant("2026-10-08", "23:30"),
    });
    const summary = await tick(
      [source(lateHabit)],
      { telegram: telegram.channel },
      limaInstant("2026-10-09", "00:30"),
    );
    expect(summary.sent).toBe(1);
    // ...and no longer at 01:30 (2 h after 23:30): skipped.
    store.rows = [];
    const expired = await tick(
      [source(lateHabit)],
      { telegram: telegram.channel },
      limaInstant("2026-10-09", "01:30"),
    );
    expect(expired).toMatchObject({ sent: 0, skipped: 1 });
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

  test("push chosen with a device row but no push channel able to send: Telegram takes over", async () => {
    store.settings = settings({ deliveryChannel: "push" });
    store.pushDevices = 1;
    const telegram = fakeChannel("telegram");
    const summary = await tick([source(candidate())], { telegram: telegram.channel });
    expect(summary).toMatchObject({ status: "ok", sent: 1 });
    expect(telegram.sent).toHaveLength(1);
    expect(store.rows).toMatchObject([{ channel: "telegram", status: "sent" }]);
  });

  test("push chosen, a device row, no push channel and no Telegram: nothing is sent", async () => {
    store.settings = settings({ deliveryChannel: "push", telegramChatId: null, linkedAt: null });
    store.pushDevices = 1;
    const summary = await tick([source(candidate())], {});
    expect(summary.status).toBe("no-channel");
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
      fail ? { ok: false, code: "telegram_server" } : { ok: true, messageId: 9 },
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

  test("an AMBIGUOUS failure (a timeout may have delivered it) is never retried: no duplicate", async () => {
    for (const code of ["telegram_network", "send_threw", "telegram_unauthorized"]) {
      store.rows = [];
      const telegram = fakeChannel("telegram", { ok: false, code });
      const sources = [source(candidate())];
      for (let index = 0; index < 3; index++) {
        await tick(
          sources,
          { telegram: telegram.channel },
          new Date(NOW.getTime() + index * 15 * 60_000),
        );
      }
      expect(telegram.sent, code).toHaveLength(1);
      expect(store.rows, code).toMatchObject([{ status: "failed", attempts: 1, errorCode: code }]);
    }
  });

  test("a channel that throws is recorded as send_threw and not retried", async () => {
    let calls = 0;
    const throwing: ReminderChannel = {
      id: "telegram",
      send: async () => {
        calls++;
        throw new Error("socket hang up");
      },
    };
    const sources = [source(candidate())];
    await tick(sources, { telegram: throwing });
    await tick(sources, { telegram: throwing }, new Date(NOW.getTime() + 15 * 60_000));
    expect(calls).toBe(1);
    expect(store.rows).toMatchObject([{ status: "failed", errorCode: "send_threw" }]);
  });

  test("rate limited: the channel is left alone for the rest of the tick and retried by the next one", async () => {
    const limited = fakeChannel("telegram", {
      ok: false,
      code: "telegram_rate_limited",
      backoff: true,
    });
    const second = candidate({
      dedupeKey: "briefing:2026-10-09",
      dueAt: limaInstant("2026-10-08", "07:00"),
    });
    const sources = [source(candidate(), second)];
    const first = await tick(sources, { telegram: limited.channel });
    // Only the first candidate was tried; the second never reached the channel in this tick.
    expect(limited.sent).toHaveLength(1);
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(store.disconnects).toEqual([]);

    // Next tick: the failed one is retried (it provably sent nothing), and so is the other.
    const ok = fakeChannel("telegram");
    const next = await tick(
      sources,
      { telegram: ok.channel },
      new Date(NOW.getTime() + 15 * 60_000),
    );
    expect(next.sent).toBe(2);
    expect(store.rows.map((row) => [row.key, row.status, row.attempts])).toEqual([
      ["briefing:2026-10-08", "sent", 2],
      ["briefing:2026-10-09", "sent", 1],
    ]);
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
    // The disconnect is conditional on the chat the tick saw (a late 403 of A must not unlink B).
    expect(store.disconnectedChats).toEqual([42]);
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
