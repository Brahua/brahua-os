// @vitest-environment node
// R1.3 of `reminders`: POST/GET /api/reminders/tick end to end (route → engine → Postgres → the
// fake Telegram through the real client): authenticated before anything else, 404 to everyone
// else, and idempotent across calls.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/reminders/tick/route";
import { registerReminderSource, type ReminderSource } from "@/modules/reminders/contracts";
import { reminderDeliveries, reminderSettings } from "@/modules/reminders/db/schema";
import { getSettings } from "@/modules/reminders/settings";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";
import { testDb } from "./test-db";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ACTIONS_SECRET = "actions-cron-secret-0123456789";
const VERCEL_SECRET = "vercel-cron-secret-0123456789";
const ORIGINAL_ENV = { ...process.env };
const CHAT_ID = 5_000_000_042;
const URL_TICK = "https://os.example.test/api/reminders/tick";

let fake: FakeTelegram;
let unregister: (() => void) | undefined;

beforeAll(async () => {
  fake = await startFakeTelegram();
});
afterAll(async () => {
  await fake.close();
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  fake.reset();
  Object.assign(process.env, {
    REMINDERS_CRON_SECRET: ACTIONS_SECRET,
    CRON_SECRET: VERCEL_SECRET,
    TELEGRAM_BOT_TOKEN: "123456:route-test-token",
    TELEGRAM_WEBHOOK_SECRET: "a-webhook-secret-0123456789",
    TELEGRAM_BOT_USERNAME: "brahua_test_bot",
    BETTER_AUTH_URL: "https://os.example.test",
    TELEGRAM_API_BASE: fake.url,
  });
  await getSettings(testDb);
});

afterEach(() => {
  unregister?.();
  unregister = undefined;
  vi.useRealTimers();
});

const tickRequest = (authorization?: string, method = "POST") =>
  new Request(URL_TICK, {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });

async function connect() {
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: CHAT_ID, linkedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(reminderSettings.id, true));
}

/** A source with one reminder due at 07:30 Lima on the clock's day, so the clock decides. */
function dueSource(text: string | null = "Buen día."): ReminderSource {
  return {
    id: "route-test",
    candidates: async ({ today }) => [
      {
        kind: "briefing",
        dedupeKey: `briefing:${today}`,
        dueAt: new Date(`${today}T12:30:00Z`),
        build: async () => text,
      },
    ],
  };
}

describe("authentication", () => {
  test.each([
    ["no Authorization header", undefined],
    ["a wrong token", "Bearer nope"],
    ["the token without Bearer", ACTIONS_SECRET],
    ["an empty Bearer", "Bearer "],
    ["a Basic header", `Basic ${ACTIONS_SECRET}`],
  ])("%s: 404 with no body, and nothing runs", async (_, authorization) => {
    await connect();
    // Inside the briefing's window, so a tick that WAS authorized would send (the control below).
    vi.useFakeTimers({ now: new Date("2026-10-08T12:35:00Z"), toFake: ["Date"] });
    unregister = registerReminderSource(dueSource());
    for (const call of [POST, GET]) {
      const response = await call(tickRequest(authorization, call === POST ? "POST" : "GET"));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(await testDb.select().from(reminderDeliveries)).toEqual([]);
    expect(fake.calls).toHaveLength(0);

    // Positive control: the same setup with the right secret does send, once.
    const ok = await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`));
    expect(ok.status).toBe(200);
    expect(fake.calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  });

  test("with no secret configured on the server every call is a 404 (even `Bearer undefined`)", async () => {
    delete process.env.REMINDERS_CRON_SECRET;
    delete process.env.CRON_SECRET;
    for (const authorization of ["Bearer undefined", "Bearer ", "Bearer x"]) {
      expect((await POST(tickRequest(authorization))).status).toBe(404);
    }
  });

  test("GitHub Actions (POST + REMINDERS_CRON_SECRET) and Vercel Cron (GET + CRON_SECRET) are both accepted", async () => {
    const actions = await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`, "POST"));
    expect(actions.status).toBe(200);
    const vercel = await GET(tickRequest(`Bearer ${VERCEL_SECRET}`, "GET"));
    expect(vercel.status).toBe(200);
    expect(vercel.headers.get("cache-control")).toBe("no-store");
  });
});

describe("a tick through the route", () => {
  test("nothing connected: answers 200 with `no-channel` and sends nothing", async () => {
    unregister = registerReminderSource(dueSource());
    const response = await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`));
    expect(await response.json()).toEqual({
      ok: true,
      status: "no-channel",
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(fake.calls).toHaveLength(0);
  });

  test("with the engine's own clock: a registered source is sent once, and a second tick adds nothing", async () => {
    await connect();
    // 07:35 Lima on 2026-10-08 (12:35 UTC): inside the briefing's window.
    vi.useFakeTimers({ now: new Date("2026-10-08T12:35:00Z"), toFake: ["Date"] });
    unregister = registerReminderSource(dueSource("Buen día. Hoy: 2 tareas."));

    const first = await (await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`))).json();
    expect(first).toMatchObject({ ok: true, status: "ok", sent: 1, failed: 0 });
    const second = await (await GET(tickRequest(`Bearer ${VERCEL_SECRET}`, "GET"))).json();
    expect(second).toMatchObject({ ok: true, sent: 0 });

    const messages = fake.calls.filter((call) => call.method === "sendMessage");
    expect(messages).toHaveLength(1);
    expect(messages[0].body.text).toBe("Buen día. Hoy: 2 tareas.\nhttps://os.example.test");
    expect(await testDb.select().from(reminderDeliveries)).toMatchObject([
      { dedupeKey: "briefing:2026-10-08", channel: "telegram", status: "sent" },
    ]);
  });

  test("the response carries counts only: no text, no chat id, no token", async () => {
    await connect();
    vi.useFakeTimers({ now: new Date("2026-10-08T12:35:00Z"), toFake: ["Date"] });
    unregister = registerReminderSource(dueSource("Texto privado del aviso."));
    const body = await (await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`))).text();
    expect(body).not.toContain("Texto privado");
    expect(body).not.toContain(String(CHAT_ID));
    expect(body).not.toContain("route-test-token");
  });

  test("with Telegram's variables missing no channel can be built: 200 `no-channel`, nothing crashes", async () => {
    await connect();
    vi.useFakeTimers({ now: new Date("2026-10-08T12:35:00Z"), toFake: ["Date"] });
    unregister = registerReminderSource(dueSource());
    delete process.env.TELEGRAM_BOT_TOKEN;
    const response = await POST(tickRequest(`Bearer ${ACTIONS_SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "no-channel" });
    expect(fake.calls).toHaveLength(0);
  });
});
