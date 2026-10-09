// Helpers of the `reminders` E2E (e2e/reminders.spec.ts): the control API of the fake Telegram
// server (e2e/support/fake-telegram-server.ts), synthetic Telegram updates and a reset of the
// reminders tables. The test-only values live in reminders-env.ts (the config reads them too).
//
// `reminder_settings` has ONE row for the whole app, so every spec that changes it must be
// serialized and run in one project only (the specs say so), and must leave it disconnected.
import { createDb } from "@/lib/db";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { E2E_CHAT_ID, FAKE_TELEGRAM_URL } from "./reminders-env";

export {
  E2E_CHAT_ID,
  E2E_TELEGRAM,
  FAKE_TELEGRAM_PORT,
  FAKE_TELEGRAM_URL,
  WEBHOOK_SECRET_HEADER,
} from "./reminders-env";

export type FakeCall = { method: string; token: string; body: Record<string, unknown> };

export async function fakeTelegramCalls(): Promise<FakeCall[]> {
  const response = await fetch(`${FAKE_TELEGRAM_URL}/__calls`);
  return (await response.json()) as FakeCall[];
}

export async function resetFakeTelegram(): Promise<void> {
  await fetch(`${FAKE_TELEGRAM_URL}/__reset`, { method: "POST" });
}

/** Makes the next `times` calls to a Bot API method fail with `status`. */
export async function failNextTelegramCall(method: string, status: number, times = 1) {
  await fetch(`${FAKE_TELEGRAM_URL}/__queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, response: { status }, times }),
  });
}

let nextUpdateId = Date.now() % 1_000_000_000;

/** A Telegram update with a text message from `chatId` (private chat). */
export function textUpdate(text: string, chatId: number = E2E_CHAT_ID) {
  return {
    update_id: ++nextUpdateId,
    message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
  };
}

export type ReminderSettingsSnapshot = {
  /** `telegram_chat_id`, null while no chat is linked (or the row does not exist yet). */
  telegramChatId: number | null;
  /** The live link codes: not used and not expired. `usedAt` is null by construction. */
  liveCodes: { usedAt: string | null }[];
  /** Every code row, spent or not (to tell "closed" from "never issued"). */
  codes: { usedAt: string | null }[];
};

/**
 * What the database says right now about the link, so a spec can assert a state instead of
 * sleeping until a poll would have noticed it.
 */
export async function readReminderSettings(): Promise<ReminderSettingsSnapshot> {
  const db = createDb(testDatabaseUrl());
  try {
    const settings = await db.$client.query<{ telegram_chat_id: string | null }>(
      "select telegram_chat_id from reminder_settings",
    );
    const codes = await db.$client.query<{ used_at: Date | null; expired: boolean }>(
      "select used_at, expires_at <= now() as expired from telegram_link_codes",
    );
    const rows = codes.rows.map((row) => ({ usedAt: row.used_at?.toISOString() ?? null }));
    return {
      telegramChatId:
        settings.rows[0]?.telegram_chat_id == null
          ? null
          : Number(settings.rows[0].telegram_chat_id),
      liveCodes: codes.rows
        .filter((row) => row.used_at === null && !row.expired)
        .map((row) => ({ usedAt: row.used_at?.toISOString() ?? null })),
      codes: rows,
    };
  } finally {
    await db.$client.end();
  }
}

/** The push subscriptions the database holds (endpoints are not secrets in the throwaway E2E app). */
export async function readPushSubscriptions(): Promise<{ endpoint: string; revoked: boolean }[]> {
  const db = createDb(testDatabaseUrl());
  try {
    const result = await db.$client.query<{ endpoint: string; revoked: boolean }>(
      "select endpoint, revoked_at is not null as revoked from push_subscriptions order by created_at",
    );
    return result.rows;
  } finally {
    await db.$client.end();
  }
}

/** The channel the owner chose (`delivery_channel`), or null while the settings row does not exist. */
export async function readDeliveryChannel(): Promise<string | null> {
  const db = createDb(testDatabaseUrl());
  try {
    const result = await db.$client.query<{ delivery_channel: string }>(
      "select delivery_channel from reminder_settings",
    );
    return result.rows[0]?.delivery_channel ?? null;
  } finally {
    await db.$client.end();
  }
}

/**
 * Leaves the reminders state as a fresh install: no chat, no pending code, no deliveries. Specs
 * call it before and after, because the settings row is shared by every spec.
 */
export async function resetReminders(): Promise<void> {
  const db = createDb(testDatabaseUrl());
  try {
    await db.$client.query("delete from telegram_captures");
    await db.$client.query("delete from telegram_updates");
    await db.$client.query("delete from telegram_link_codes");
    await db.$client.query("delete from reminder_deliveries");
    await db.$client.query("delete from push_subscriptions");
    await db.$client.query("delete from reminder_settings");
  } finally {
    await db.$client.end();
  }
}
