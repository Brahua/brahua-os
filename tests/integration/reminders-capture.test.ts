// @vitest-environment node
// R3 of `reminders`: the bot's capture against Postgres and the fake Bot API. A message from the
// linked chat becomes a task (inbox) or an expense, the reply says what was understood and carries
// "Deshacer", which undoes EXACTLY that capture and never one the owner touched since. Everything
// runs through the real webhook handler and the real composition root (`src/lib/bot-capture.ts`).
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { botCapture } from "@/lib/bot-capture";
import { financeExpenses } from "@/modules/finance/db/schema";
import { formatMoney } from "@/modules/finance/money";
import { createTelegramClient } from "@/modules/reminders/channels/telegram/client";
import {
  BOT_EXPENSE_USAGE_MESSAGE,
  BOT_HELP_MESSAGE,
  BOT_INVALID_MESSAGE,
  BOT_NO_AMOUNT_MESSAGE,
  BOT_NON_TEXT_MESSAGE,
  BOT_TASK_USAGE_MESSAGE,
  BOT_TODAY_EMPTY_MESSAGE,
  BOT_TODAY_FAILED_MESSAGE,
  BOT_TOO_LONG_EXPENSE_MESSAGE,
  BOT_TOO_LONG_TASK_MESSAGE,
  BOT_UNDO_CHANGED_MESSAGE,
  BOT_UNDO_EXPIRED_MESSAGE,
  BOT_UNDO_GONE_MESSAGE,
  BOT_UNDONE_MESSAGE,
  BOT_UNKNOWN_COMMAND_MESSAGE,
} from "@/modules/reminders/channels/telegram/copy";
import {
  handleTelegramWebhook,
  WEBHOOK_SECRET_HEADER,
} from "@/modules/reminders/channels/telegram/webhook";
import type { BotCapture, ReminderSource } from "@/modules/reminders/contracts";
import { reminderSettings, telegramCaptures, telegramUpdates } from "@/modules/reminders/db/schema";
import { disconnectTelegram, getSettings } from "@/modules/reminders/settings";
import { tasks } from "@/modules/tasks/db/schema";
import { replaceTaskTags } from "@/modules/tasks/tags";
import { startFakeTelegram, type FakeTelegram } from "../support/fake-telegram";
import { testDb } from "./test-db";

// Revalidation is recorded, not performed (there is no Next request here).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SECRET = "a-webhook-secret-0123456789";
const ENV = { TELEGRAM_WEBHOOK_SECRET: SECRET };
// 2026-10-08 07:00 in Lima (a Thursday): «mañana» is vie 9 oct.
const NOW = new Date("2026-10-08T12:00:00Z");
const OWNER_CHAT = 5_000_000_001;
const STRANGER_CHAT = 5_000_000_999;
const APP_URL = "https://os.example.test";

let fake: FakeTelegram;
beforeAll(async () => {
  fake = await startFakeTelegram();
});
afterAll(async () => {
  await fake.close();
});
beforeEach(async () => {
  fake.reset();
  vi.mocked(revalidatePath).mockClear();
  // The owner's chat is linked (the table is emptied before each test).
  await getSettings(testDb);
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: OWNER_CHAT, linkedAt: NOW })
    .where(eq(reminderSettings.id, true));
});

const client = () =>
  createTelegramClient({ token: "123456:capture-test-token", apiBase: fake.url });

let nextUpdateId = 100;

function messageUpdate(text: string | undefined, chatId = OWNER_CHAT, updateId?: number) {
  return {
    update_id: updateId ?? nextUpdateId++,
    message: {
      message_id: 10,
      chat: { id: chatId, type: "private" },
      ...(text === undefined ? {} : { text }),
    },
  };
}

function tapUpdate(data: string, fromId = OWNER_CHAT, updateId?: number) {
  return {
    update_id: updateId ?? nextUpdateId++,
    callback_query: {
      id: `cb-${nextUpdateId}`,
      from: { id: fromId },
      data,
      message: { chat: { id: fromId, type: "private" } },
    },
  };
}

function post(body: unknown) {
  return new Request("https://os.example.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", [WEBHOOK_SECRET_HEADER]: SECRET },
    body: JSON.stringify(body),
  });
}

type Options = { capture?: BotCapture; sources?: () => readonly ReminderSource[] };

const handle = (body: unknown, options: Options = {}) =>
  handleTelegramWebhook(post(body), {
    db: testDb,
    client: client(),
    now: NOW,
    env: ENV,
    capture: options.capture ?? botCapture,
    appUrl: APP_URL,
    ...(options.sources ? { sources: options.sources } : {}),
  });

/** Sends a text from the owner's chat. */
async function say(text: string | undefined, options: Options = {}) {
  const response = await handle(messageUpdate(text), options);
  expect(response.status).toBe(200);
}

const sent = () => fake.calls.filter((call) => call.method === "sendMessage");
const answered = () => fake.calls.filter((call) => call.method === "answerCallbackQuery");
const lastReply = () =>
  sent().at(-1)?.body as {
    chat_id: number;
    text: string;
    reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
  };
const undoData = () => lastReply().reply_markup?.inline_keyboard[0][0].callback_data as string;

const allTasks = () => testDb.select().from(tasks);
const allExpenses = () => testDb.select().from(financeExpenses);
const captures = () => testDb.select().from(telegramCaptures);

describe("tasks", () => {
  test("«pilas mañana» is a task due tomorrow, in the inbox, with Deshacer", async () => {
    await say("pilas mañana");
    const [task] = await allTasks();
    expect(task).toMatchObject({
      title: "pilas",
      dueDate: "2026-10-09",
      lifeAreaId: null,
      projectId: null,
      deletedAt: null,
    });
    expect(await allExpenses()).toEqual([]);

    expect(sent()).toHaveLength(1);
    expect(lastReply()).toMatchObject({ chat_id: OWNER_CHAT, text: "Anotado: pilas · vie 9 oct" });
    // The button carries the id of the CAPTURE, never the task's.
    const [capture] = await captures();
    expect(capture).toMatchObject({ entityKind: "task", entityId: task.id });
    expect(undoData()).toBe(`u:${capture.id}`);
    expect(undoData()).not.toContain(task.id);
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("an hour is kept: «reunión mañana 10am»", async () => {
    await say("reunión mañana 10am");
    const [task] = await allTasks();
    expect(task.dueDate).toBe("2026-10-09");
    expect(task.dueTime?.slice(0, 5)).toBe("10:00");
    expect(lastReply().text).toBe("Anotado: reunión · vie 9 oct · 10:00");
  });

  test("what the parser does not understand goes to the inbox as written, and the bot says so", async () => {
    await say("ideas para el viaje");
    const [task] = await allTasks();
    expect(task).toMatchObject({ title: "ideas para el viaje", dueDate: null, lifeAreaId: null });
    expect(lastReply().text).toBe("A la bandeja: ideas para el viaje");
  });

  test("«café 12» (a bare integer) is a task, not an expense", async () => {
    await say("café 12");
    expect((await allTasks()).map((task) => task.title)).toEqual(["café 12"]);
    expect(await allExpenses()).toEqual([]);
  });

  test("/tarea forces a task even with an amount in it", async () => {
    await say("/tarea 12.50 café");
    expect((await allTasks()).map((task) => task.title)).toEqual(["12.50 café"]);
    expect(await allExpenses()).toEqual([]);
  });

  test("a text too long for a title is refused, said, and nothing is stored", async () => {
    await say("x".repeat(250));
    expect(await allTasks()).toEqual([]);
    expect(await captures()).toEqual([]);
    expect(lastReply().text).toBe(BOT_TOO_LONG_TASK_MESSAGE);
    expect(lastReply().reply_markup).toBeUndefined();
    // The update itself was handled once (Telegram will not retry it).
    expect(await testDb.select().from(telegramUpdates)).toHaveLength(1);
  });

  test("invisible-only text is refused with the generic message", async () => {
    await say("​​");
    expect(await allTasks()).toEqual([]);
    expect(lastReply().text).toBe(BOT_INVALID_MESSAGE);
  });
});

describe("expenses", () => {
  test("«12.50 café» is an expense of today, and the reply says the amount", async () => {
    await say("12.50 café");
    const [expense] = await allExpenses();
    expect(expense).toMatchObject({
      amountCents: 1250,
      description: "café",
      spentOn: "2026-10-08",
      currency: "PEN",
      deletedAt: null,
    });
    expect(await allTasks()).toEqual([]);
    expect(lastReply().text).toBe(`Gasto: ${formatMoney(1250, "PEN")} · café`);
    const [capture] = await captures();
    expect(capture).toMatchObject({ entityKind: "expense", entityId: expense.id });
    expect(undoData()).toBe(`u:${capture.id}`);
  });

  test("a currency mark is enough: «USD 95 claude»", async () => {
    await say("USD 95 claude");
    const [expense] = await allExpenses();
    expect(expense).toMatchObject({ amountCents: 9500, currency: "USD", description: "claude" });
    expect(lastReply().text).toBe(`Gasto: ${formatMoney(9500, "USD")} · claude`);
  });

  test("/gasto forces an expense with a bare integer", async () => {
    await say("/gasto café 12");
    const [expense] = await allExpenses();
    expect(expense).toMatchObject({ amountCents: 1200, description: "café" });
    expect(await allTasks()).toEqual([]);
  });

  test("/gasto with no amount in the text says so and stores nothing", async () => {
    await say("/gasto café");
    expect(await allExpenses()).toEqual([]);
    expect(await captures()).toEqual([]);
    expect(lastReply().text).toBe(BOT_NO_AMOUNT_MESSAGE);
  });

  test("an expense with a description over the limit is refused, not cut", async () => {
    await say(`/gasto 5 ${"a".repeat(100)}`);
    expect(await allExpenses()).toEqual([]);
    expect(lastReply().text).toBe(BOT_TOO_LONG_EXPENSE_MESSAGE);
  });
});

describe("commands", () => {
  test("/ayuda, and a bare /start from the linked chat, show the help", async () => {
    await say("/ayuda");
    expect(lastReply().text).toBe(BOT_HELP_MESSAGE);
    await say("/start");
    expect(sent()).toHaveLength(2);
    expect(lastReply().text).toBe(BOT_HELP_MESSAGE);
    expect(await allTasks()).toEqual([]);
  });

  test("/tarea and /gasto with nothing after them explain how", async () => {
    await say("/tarea");
    expect(lastReply().text).toBe(BOT_TASK_USAGE_MESSAGE);
    await say("/gasto");
    expect(lastReply().text).toBe(BOT_EXPENSE_USAGE_MESSAGE);
    expect(await allTasks()).toEqual([]);
    expect(await allExpenses()).toEqual([]);
  });

  test("an unknown command is not saved as a task", async () => {
    await say("/borrar todo");
    expect(lastReply().text).toBe(BOT_UNKNOWN_COMMAND_MESSAGE);
    expect(await allTasks()).toEqual([]);
  });

  test("the command with the bot's name works: /tarea@mi_bot pilas", async () => {
    await say("/tarea@mi_bot pilas");
    expect((await allTasks()).map((task) => task.title)).toEqual(["pilas"]);
  });

  test("a message with no text (a photo) is answered once and stores nothing", async () => {
    await say(undefined);
    expect(lastReply().text).toBe(BOT_NON_TEXT_MESSAGE);
    expect(await allTasks()).toEqual([]);
  });

  test("/hoy answers with the briefing of the registered sources, with the app link", async () => {
    const source: ReminderSource = {
      id: "test",
      candidates: async () => [],
      briefingFacts: async () => ({ tasksDueToday: 2 }),
    };
    await say("/hoy", { sources: () => [source] });
    expect(lastReply().text).toBe(`Buen día. Hoy: 2 tareas.\n${APP_URL}`);
    expect(await allTasks()).toEqual([]);
  });

  test("/hoy on an empty day says so", async () => {
    await say("/hoy", { sources: () => [] });
    expect(lastReply().text).toBe(`${BOT_TODAY_EMPTY_MESSAGE}\n${APP_URL}`);
  });

  test("/hoy with a failing source answers kindly and does not make Telegram retry", async () => {
    const broken: ReminderSource = {
      id: "broken",
      candidates: async () => [],
      briefingFacts: async () => {
        throw new Error("secret detail that must not leak");
      },
    };
    await say("/hoy", { sources: () => [broken] });
    expect(lastReply().text).toBe(BOT_TODAY_FAILED_MESSAGE);
    expect(lastReply().text).not.toContain("secret");
  });
});

describe("Deshacer", () => {
  test("a tap removes exactly the captured task and says so; a second tap says it is gone", async () => {
    await say("pilas mañana");
    const data = undoData();
    fake.reset();

    expect((await handle(tapUpdate(data))).status).toBe(200);
    expect((await allTasks())[0].deletedAt).not.toBeNull();
    expect(answered()).toHaveLength(1);
    expect(answered()[0].body).toMatchObject({ text: BOT_UNDONE_MESSAGE });
    expect(revalidatePath).toHaveBeenCalled();

    expect((await handle(tapUpdate(data))).status).toBe(200);
    expect(answered()[1].body).toMatchObject({ text: BOT_UNDO_GONE_MESSAGE });
  });

  test("it undoes THAT capture and leaves the newer ones alone", async () => {
    await say("primera");
    const firstData = undoData();
    await say("segunda");
    await handle(tapUpdate(firstData));
    const rows = await allTasks();
    expect(rows.find((task) => task.title === "primera")?.deletedAt).not.toBeNull();
    expect(rows.find((task) => task.title === "segunda")?.deletedAt).toBeNull();
  });

  test("a task the owner edited since is NOT touched, and the bot says so", async () => {
    await say("pilas");
    const [task] = await allTasks();
    const data = undoData();
    await testDb.update(tasks).set({ title: "pilas AA" }).where(eq(tasks.id, task.id));
    await handle(tapUpdate(data));
    const [after] = await allTasks();
    expect(after).toMatchObject({ title: "pilas AA", deletedAt: null });
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDO_CHANGED_MESSAGE });
  });

  test("a task already completed is NOT touched", async () => {
    await say("pilas");
    const [task] = await allTasks();
    const data = undoData();
    await testDb.update(tasks).set({ doneAt: new Date() }).where(eq(tasks.id, task.id));
    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDO_CHANGED_MESSAGE });
  });

  test("an expense is undone the same way, and not when it was edited", async () => {
    await say("12.50 café");
    const firstData = undoData();
    await say("8.00 pan");
    const secondData = undoData();
    const edited = (await allExpenses()).find((expense) => expense.description === "pan")!;
    await testDb
      .update(financeExpenses)
      .set({ description: "pan integral" })
      .where(eq(financeExpenses.id, edited.id));

    await handle(tapUpdate(firstData));
    await handle(tapUpdate(secondData));
    const rows = await allExpenses();
    expect(rows.find((expense) => expense.description === "café")?.deletedAt).not.toBeNull();
    expect(rows.find((expense) => expense.description === "pan integral")?.deletedAt).toBeNull();
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDO_CHANGED_MESSAGE });
  });

  test("a tap from a stranger does nothing and is not even answered (positive control: the owner's works)", async () => {
    await say("pilas");
    const data = undoData();
    fake.reset();
    expect((await handle(tapUpdate(data, STRANGER_CHAT))).status).toBe(200);
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered()).toHaveLength(0);

    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).not.toBeNull();
  });

  test("malformed or unknown callback data is answered as gone and touches nothing", async () => {
    await say("pilas");
    await handle(tapUpdate("u:not-a-uuid"));
    await handle(tapUpdate("u:00000000-0000-4000-8000-000000000000"));
    await handle(tapUpdate("something else"));
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered().map((call) => call.body.text)).toEqual([
      BOT_UNDO_GONE_MESSAGE,
      BOT_UNDO_GONE_MESSAGE,
      BOT_UNDO_GONE_MESSAGE,
    ]);
  });

  test("a button older than a day no longer undoes (positive control: 23 hours still does)", async () => {
    await say("pilas");
    const data = undoData();
    await testDb.execute(
      sql`update telegram_captures set created_at = now() - interval '25 hours'`,
    );
    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDO_EXPIRED_MESSAGE });

    await testDb.execute(
      sql`update telegram_captures set created_at = now() - interval '23 hours'`,
    );
    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).not.toBeNull();
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDONE_MESSAGE });
  });

  test("editing the tags of a task counts as touching it", async () => {
    await say("pilas");
    const [task] = await allTasks();
    const data = undoData();
    await replaceTaskTags(testDb, task.id, ["casa"]);
    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered().at(-1)?.body).toMatchObject({ text: BOT_UNDO_CHANGED_MESSAGE });
  });

  test("a retried tap (same update_id) only stops the spinner", async () => {
    await say("pilas");
    const tap = tapUpdate(undoData(), OWNER_CHAT, 9100);
    await handle(tap);
    await handle(tap);
    expect(answered()).toHaveLength(2);
    expect(answered()[0].body).toMatchObject({ text: BOT_UNDONE_MESSAGE });
    expect(answered()[1].body.text).toBeUndefined();
  });

  test("after a disconnect the old buttons do nothing", async () => {
    await say("pilas");
    const data = undoData();
    await disconnectTelegram(testDb, "owner", NOW);
    fake.reset();
    await handle(tapUpdate(data));
    expect((await allTasks())[0].deletedAt).toBeNull();
    expect(answered()).toHaveLength(0);
  });
});

describe("who and how often", () => {
  test("an unknown chat creates nothing and gets no answer (positive control: the owner does)", async () => {
    await handle(messageUpdate("pilas mañana", STRANGER_CHAT));
    await handle(messageUpdate("12.50 café", STRANGER_CHAT));
    expect(await allTasks()).toEqual([]);
    expect(await allExpenses()).toEqual([]);
    expect(await captures()).toEqual([]);
    expect(await testDb.select().from(telegramUpdates)).toEqual([]);
    expect(sent()).toHaveLength(0);

    await say("pilas mañana");
    expect(await allTasks()).toHaveLength(1);
    expect(sent()).toHaveLength(1);
  });

  test("a repeated update_id is captured, answered and counted once", async () => {
    const repeated = messageUpdate("pilas mañana", OWNER_CHAT, 9001);
    expect((await handle(repeated)).status).toBe(200);
    expect((await handle(repeated)).status).toBe(200);
    expect((await handle(repeated)).status).toBe(200);
    expect(await allTasks()).toHaveLength(1);
    expect(await captures()).toHaveLength(1);
    expect(sent()).toHaveLength(1);
    // Positive control: a different update_id with the same text is a second task.
    await handle(messageUpdate("pilas mañana"));
    expect(await allTasks()).toHaveLength(2);
  });

  test("a failure while capturing rolls EVERYTHING back (500) and the retry works", async () => {
    const exploding: BotCapture = {
      ...botCapture,
      create: async (db, input) => {
        await botCapture.create(db, input); // the task really is inserted…
        throw new Error("boom"); // …and then the handling fails.
      },
    };
    const request = messageUpdate("pilas mañana", OWNER_CHAT, 9002);
    expect((await handle(request, { capture: exploding })).status).toBe(500);
    expect(await allTasks()).toEqual([]);
    expect(await captures()).toEqual([]);
    expect(await testDb.select().from(telegramUpdates)).toEqual([]);
    expect(sent()).toHaveLength(0);

    expect((await handle(request)).status).toBe(200);
    expect(await allTasks()).toHaveLength(1);
    expect(sent()).toHaveLength(1);
  });

  test("a poison update (a permanent data error) is claimed and answered 200: no retry loop", async () => {
    const poisoned: BotCapture = {
      ...botCapture,
      create: async () => {
        throw Object.assign(new Error("Failed query"), {
          cause: Object.assign(new Error("pg"), { code: "22021" }),
        });
      },
    };
    const request = messageUpdate("pilas", OWNER_CHAT, 9003);
    expect((await handle(request, { capture: poisoned })).status).toBe(200);
    expect(await allTasks()).toEqual([]);
    expect(sent()).toHaveLength(0);
    // Its id is claimed, so Telegram's retry is a duplicate (positive control of the 500 above,
    // where a transient error leaves the id free).
    expect((await testDb.select().from(telegramUpdates)).map((row) => row.updateId)).toEqual([
      9003,
    ]);
    expect((await handle(request)).status).toBe(200);
    expect(await allTasks()).toEqual([]);
  });

  test("a NUL byte in the text is dropped and the capture works", async () => {
    await say("pil\u0000as");
    expect((await allTasks()).map((task) => task.title)).toEqual(["pilas"]);
  });

  test("a failed reply keeps the capture and is not retried (a duplicate is worse than a missing one)", async () => {
    fake.queue("sendMessage", { status: 500 });
    await say("pilas mañana");
    expect(await allTasks()).toHaveLength(1);
    expect(sent()).toHaveLength(1);
    // Telegram sends the same update again: still one task, no second reply.
    await handle(messageUpdate("pilas mañana", OWNER_CHAT, nextUpdateId - 1));
    expect(await allTasks()).toHaveLength(1);
    expect(sent()).toHaveLength(1);
  });

  test("a 403 on the reply does not disconnect the chat (the engine owns that, with the expected chat)", async () => {
    fake.queue("sendMessage", { status: 403 });
    await say("pilas");
    expect((await getSettings(testDb)).telegramChatId).toBe(OWNER_CHAT);
  });
});
