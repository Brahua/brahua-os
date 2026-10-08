// @vitest-environment node
// R1.2 of `reminders`: the Telegram webhook (the R1 part) against Postgres and the fake Bot API:
// the secret is checked before the body is read, a stranger's chat gets nothing and stores
// nothing, `/start <code>` links, and Telegram's retries (same `update_id`) are handled once.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTelegramClient } from "@/modules/reminders/channels/telegram/client";
import { BOT_LINKED_MESSAGE } from "@/modules/reminders/channels/telegram/copy";
import { issueLinkCode } from "@/modules/reminders/channels/telegram/link";
import {
  handleTelegramWebhook,
  MAX_WEBHOOK_BODY_BYTES,
  WEBHOOK_SECRET_HEADER,
} from "@/modules/reminders/channels/telegram/webhook";
import {
  telegramCaptures,
  telegramLinkCodes,
  telegramUpdates,
} from "@/modules/reminders/db/schema";
import { disconnectTelegram, getSettings } from "@/modules/reminders/settings";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";
import { testDb } from "./test-db";

const SECRET = "a-webhook-secret-0123456789";
const ENV = { TELEGRAM_WEBHOOK_SECRET: SECRET };
const NOW = new Date("2026-10-08T12:00:00Z");
const OWNER_CHAT = 5_000_000_001;
const STRANGER_CHAT = 5_000_000_999;

let fake: FakeTelegram;
beforeAll(async () => {
  fake = await startFakeTelegram();
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  fake.reset();
});

const client = () =>
  createTelegramClient({ token: "123456:webhook-test-token", apiBase: fake.url });

type UpdateOptions = { chatId?: number; text?: string; chatType?: string; updateId?: number };
let nextUpdateId = 1;

function update({ chatId = OWNER_CHAT, text, chatType = "private", updateId }: UpdateOptions) {
  return {
    update_id: updateId ?? nextUpdateId++,
    message: {
      message_id: 10,
      chat: { id: chatId, type: chatType },
      ...(text === undefined ? {} : { text }),
    },
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { [WEBHOOK_SECRET_HEADER]: SECRET },
) {
  return new Request("https://os.example.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const handle = (request: Request) =>
  handleTelegramWebhook(request, { db: testDb, client: client(), now: NOW, env: ENV });

const updates = () => testDb.select().from(telegramUpdates);
const sent = () => fake.calls.filter((call) => call.method === "sendMessage");

async function liveCode() {
  const issued = await issueLinkCode(testDb, NOW);
  if (!issued) throw new Error("no code issued");
  return issued.code;
}

describe("authentication", () => {
  test("without the secret header: 401, and the body is never read", async () => {
    await getSettings(testDb);
    let bodyTouched = false;
    const request = {
      headers: new Headers(),
      get body() {
        bodyTouched = true;
        return null;
      },
      text: async () => {
        bodyTouched = true;
        return "";
      },
      json: async () => {
        bodyTouched = true;
        return {};
      },
    } as unknown as Request;
    const response = await handle(request);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(bodyTouched).toBe(false);
    expect(await updates()).toEqual([]);
  });

  test("with a wrong secret: 401 and nothing is stored or answered", async () => {
    const code = await liveCode();
    const response = await handle(
      post(update({ text: `/start ${code}` }), { [WEBHOOK_SECRET_HEADER]: "not-the-secret" }),
    );
    expect(response.status).toBe(401);
    expect(await updates()).toEqual([]);
    expect(sent()).toHaveLength(0);
    expect((await getSettings(testDb)).telegramChatId).toBeNull();
  });

  test("with no secret configured on the server, nothing is accepted", async () => {
    const response = await handleTelegramWebhook(post(update({ text: "hola" })), {
      db: testDb,
      client: client(),
      now: NOW,
      env: {},
    });
    expect(response.status).toBe(401);
  });

  test("the right secret gets through (positive control)", async () => {
    expect((await handle(post(update({ text: "hola" })))).status).toBe(200);
    expect(await updates()).toHaveLength(1);
  });
});

describe("the body", () => {
  test("a body over the limit is refused with 413 before being parsed", async () => {
    const big = JSON.stringify({ update_id: 1, pad: "x".repeat(MAX_WEBHOOK_BODY_BYTES) });
    expect((await handle(post(big))).status).toBe(413);
    expect(await updates()).toEqual([]);
  });

  test("a body over the limit with no content-length is cut while reading", async () => {
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 50) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const request = new Request("https://os.example.test/api/telegram/webhook", {
      method: "POST",
      headers: { [WEBHOOK_SECRET_HEADER]: SECRET },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handle(request)).status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  test("invalid JSON is a 400; a JSON that is not an update is ignored with 200", async () => {
    expect((await handle(post("{not json"))).status).toBe(400);
    expect((await handle(post({ hello: "world" }))).status).toBe(200);
    expect((await handle(post({ update_id: "abc" }))).status).toBe(200);
    expect(await updates()).toEqual([]);
  });

  test("an update with no message (an edit, a poll…) is recorded and ignored", async () => {
    expect((await handle(post({ update_id: 321 }))).status).toBe(200);
    expect((await updates()).map((row) => row.updateId)).toEqual([321]);
    expect(sent()).toHaveLength(0);
  });
});

describe("linking with /start <code>", () => {
  test("a valid code links the chat and the bot says so", async () => {
    const code = await liveCode();
    const response = await handle(post(update({ text: `/start ${code}` })));
    expect(response.status).toBe(200);

    const settings = await getSettings(testDb);
    expect(settings.telegramChatId).toBe(OWNER_CHAT);
    expect(settings.linkedAt).toEqual(NOW);
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body).toMatchObject({ chat_id: OWNER_CHAT, text: BOT_LINKED_MESSAGE });
  });

  test("a wrong code from an unknown chat: 200, no reply, nothing linked, nothing created", async () => {
    await liveCode();
    const response = await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH" })));
    expect(response.status).toBe(200);
    expect(sent()).toHaveLength(0);
    const settings = await getSettings(testDb);
    expect(settings.telegramChatId).toBeNull();
    expect(await testDb.select().from(telegramCaptures)).toEqual([]);
  });

  test("five wrong /start in a row close the live code, even for the right one", async () => {
    const code = await liveCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH" })));
    }
    await handle(post(update({ text: `/start ${code}` })));
    expect((await getSettings(testDb)).telegramChatId).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  test("an expired code does not link", async () => {
    const issued = await issueLinkCode(testDb, new Date(NOW.getTime() - 11 * 60_000));
    expect(issued).not.toBeNull();
    await handle(post(update({ text: `/start ${issued!.code}` })));
    expect((await getSettings(testDb)).telegramChatId).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  test("a spent code does not link another chat", async () => {
    const code = await liveCode();
    await handle(post(update({ text: `/start ${code}` })));
    await disconnectTelegram(testDb, "owner", NOW);
    fake.reset();
    await handle(post(update({ chatId: STRANGER_CHAT, text: `/start ${code}` })));
    expect((await getSettings(testDb)).telegramChatId).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  test("a stranger cannot take over a linked bot, with or without a code", async () => {
    const code = await liveCode();
    await handle(post(update({ text: `/start ${code}` })));
    fake.reset();
    await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH" })));
    await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ZZZZ2222" })));
    await handle(post(update({ chatId: STRANGER_CHAT, text: "hola" })));
    expect((await getSettings(testDb)).telegramChatId).toBe(OWNER_CHAT);
    expect(sent()).toHaveLength(0);
  });

  test("a group chat is ignored even with a valid code", async () => {
    const code = await liveCode();
    await handle(
      post(update({ chatId: -1001234567890, chatType: "supergroup", text: `/start ${code}` })),
    );
    expect((await getSettings(testDb)).telegramChatId).toBeNull();
    // The code is still good (positive control): the private chat links.
    await handle(post(update({ text: `/start ${code}` })));
    expect((await getSettings(testDb)).telegramChatId).toBe(OWNER_CHAT);
  });

  test("plain text from the unknown chat is ignored: no reply, nothing stored but the update id", async () => {
    await handle(post(update({ chatId: STRANGER_CHAT, text: "pilas mañana" })));
    expect(sent()).toHaveLength(0);
    expect(await testDb.select().from(telegramCaptures)).toEqual([]);
    expect(await updates()).toHaveLength(1);
  });

  test("a failure sending the reply does not undo the link", async () => {
    const code = await liveCode();
    fake.queue("sendMessage", { status: 500 });
    expect((await handle(post(update({ text: `/start ${code}` })))).status).toBe(200);
    expect((await getSettings(testDb)).telegramChatId).toBe(OWNER_CHAT);
  });
});

describe("Telegram's retries", () => {
  test("the same update_id is handled once: a repeated wrong code counts once", async () => {
    await liveCode();
    const repeated = update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH", updateId: 777 });
    expect((await handle(post(repeated))).status).toBe(200);
    expect((await handle(post(repeated))).status).toBe(200);
    expect((await handle(post(repeated))).status).toBe(200);
    const [row] = await testDb.select().from(telegramLinkCodes);
    expect(row.failedAttempts).toBe(1);
    expect((await updates()).filter((u) => u.updateId === 777)).toHaveLength(1);
  });

  test("a different update_id with the same text counts again (positive control)", async () => {
    await liveCode();
    await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH" })));
    await handle(post(update({ chatId: STRANGER_CHAT, text: "/start ABCDEFGH" })));
    const [row] = await testDb.select().from(telegramLinkCodes);
    expect(row.failedAttempts).toBe(2);
  });

  test("the update id is not claimed when handling fails (Telegram's retry gets a fair go)", async () => {
    const code = await liveCode();
    // Break the handling AFTER the claim on purpose: the link-code table is renamed for a moment,
    // so the transaction that already inserted the update id fails and rolls it back.
    await testDb.execute(
      sql.raw("alter table telegram_link_codes rename to telegram_link_codes_gone"),
    );
    let status = 0;
    try {
      status = (await handle(post(update({ text: `/start ${code}`, updateId: 888 })))).status;
    } finally {
      await testDb.execute(
        sql.raw("alter table telegram_link_codes_gone rename to telegram_link_codes"),
      );
    }
    expect(status).toBe(500);
    expect((await updates()).filter((u) => u.updateId === 888)).toEqual([]);
    expect((await getSettings(testDb)).telegramChatId).toBeNull();

    // The retry with the same update_id now works.
    expect((await handle(post(update({ text: `/start ${code}`, updateId: 888 })))).status).toBe(
      200,
    );
    expect((await getSettings(testDb)).telegramChatId).toBe(OWNER_CHAT);
  });
});
