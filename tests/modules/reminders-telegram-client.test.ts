// @vitest-environment node
// reminders → the Telegram client against the fake Bot API server (a real HTTP round trip).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createTelegramClient } from "@/modules/reminders/channels/telegram/client";
import { createTelegramChannel } from "@/modules/reminders/channels/telegram/channel";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";

const TOKEN = "123456:SECRET-token_value";
let fake: FakeTelegram;

beforeAll(async () => {
  fake = await startFakeTelegram();
});
afterAll(async () => {
  await fake.close();
});
afterEach(() => fake.reset());

const client = () => createTelegramClient({ token: TOKEN, apiBase: fake.url });

describe("sendMessage", () => {
  test("posts the text to /bot<token>/sendMessage and returns the message id", async () => {
    const result = await client().sendMessage({ chatId: 42, text: "Hola" });
    expect(result).toEqual({ ok: true, result: { messageId: 1000 } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe("sendMessage");
    expect(fake.calls[0].token).toBe(TOKEN);
    expect(fake.calls[0].body).toMatchObject({
      chat_id: 42,
      text: "Hola",
      link_preview_options: { is_disabled: true },
    });
    expect(fake.calls[0].body).not.toHaveProperty("reply_markup");
  });

  test("sends inline buttons as one keyboard row", async () => {
    await client().sendMessage({
      chatId: 42,
      text: "Anotado",
      buttons: [{ text: "Deshacer", callbackData: "undo:abc" }],
    });
    expect(fake.calls[0].body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Deshacer", callback_data: "undo:abc" }]],
    });
  });

  test.each([
    [403, "forbidden"],
    [401, "unauthorized"],
    [404, "unauthorized"],
    [400, "bad_request"],
    [429, "rate_limited"],
    [500, "server"],
  ] as const)("HTTP %s is `%s`", async (status, kind) => {
    fake.queue("sendMessage", { status });
    const result = await client().sendMessage({ chatId: 1, text: "x" });
    expect(result).toEqual({ ok: false, kind });
  });

  test("a rate limit carries retryAfter", async () => {
    fake.queue("sendMessage", { status: 429, extra: { parameters: { retry_after: 7 } } });
    expect(await client().sendMessage({ chatId: 1, text: "x" })).toEqual({
      ok: false,
      kind: "rate_limited",
      retryAfter: 7,
    });
  });

  test("an unreachable server is `network`, and the error never carries the token", async () => {
    const dead = createTelegramClient({ token: TOKEN, apiBase: "http://127.0.0.1:1" });
    const result = await dead.sendMessage({ chatId: 1, text: "x" });
    expect(result).toEqual({ ok: false, kind: "network" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("a slow server times out as `network`", async () => {
    const slow = createTelegramClient({
      token: TOKEN,
      apiBase: fake.url,
      timeoutMs: 20,
      fetch: (input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error(`aborted ${String(input)}`)),
          );
        }),
    });
    expect(await slow.sendMessage({ chatId: 1, text: "x" })).toEqual({
      ok: false,
      kind: "network",
    });
  });
});

describe("answerCallbackQuery and setWebhook", () => {
  test("answerCallbackQuery posts the query id and the optional text", async () => {
    expect(await client().answerCallbackQuery("cb-1", "Listo")).toEqual({ ok: true, result: true });
    expect(fake.calls[0]).toMatchObject({
      method: "answerCallbackQuery",
      body: { callback_query_id: "cb-1", text: "Listo" },
    });
  });

  test("setWebhook sends the url and the secret token, and only the update types we handle", async () => {
    const url = "https://os.brahua.com/api/telegram/webhook";
    expect(await client().setWebhook(url, "the-webhook-secret-0123")).toEqual({
      ok: true,
      result: true,
    });
    expect(fake.calls[0].body).toEqual({
      url,
      secret_token: "the-webhook-secret-0123",
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  });

  test("setWebhook failure is reduced to a kind", async () => {
    fake.queue("setWebhook", { status: 401 });
    expect(await client().setWebhook("https://x.test/hook", "s".repeat(20))).toEqual({
      ok: false,
      kind: "unauthorized",
    });
  });
});

describe("the Telegram channel", () => {
  const channel = (chatId = 42) =>
    createTelegramChannel({ client: client(), chatId, appUrl: "https://os.brahua.com" });

  test("sends the text followed by the app link, and returns the message id", async () => {
    const result = await channel().send({ text: "Buen día.", dedupeKey: "briefing:2026-10-08" });
    expect(result).toEqual({ ok: true, messageId: 1000 });
    expect(fake.calls[0].body.text).toBe("Buen día.\nhttps://os.brahua.com");
    expect(fake.calls[0].body.chat_id).toBe(42);
  });

  test("403 is unreachable (the engine disconnects the chat)", async () => {
    fake.queue("sendMessage", { status: 403 });
    expect(await channel().send({ text: "x", dedupeKey: "k" })).toEqual({
      ok: false,
      code: "unreachable",
      unreachable: true,
    });
  });

  test("other failures are retryable codes", async () => {
    fake.queue("sendMessage", { status: 500 });
    expect(await channel().send({ text: "x", dedupeKey: "k" })).toEqual({
      ok: false,
      code: "telegram_server",
    });
  });
});

test("never follows a redirect (the token is in the URL) and a redirect is just a `network` failure", async () => {
  let init: RequestInit | undefined;
  const redirecting = createTelegramClient({
    token: TOKEN,
    apiBase: fake.url,
    fetch: async (_input, options) => {
      init = options;
      throw new TypeError("redirect mode is set to error");
    },
  });
  expect(await redirecting.sendMessage({ chatId: 1, text: "x" })).toEqual({
    ok: false,
    kind: "network",
  });
  expect(init?.redirect).toBe("error");
});

test("the real fetch is used when none is injected", async () => {
  const spy = vi.spyOn(globalThis, "fetch");
  await client().answerCallbackQuery("x");
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
