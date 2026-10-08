"use server";

// Server Actions of Ajustes → Avisos (R1: connect and disconnect Telegram; R2: the day's reminders). Each goes through
// ownerAction() (owner first, Zod, an ActionResult). "Conectar" registers the webhook with the
// bot token from the server's environment (nobody handles the token elsewhere) and issues the
// one-use link. The token and the webhook secret never reach the client or the logs.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { createTelegramClient } from "./channels/telegram/client";
import { issueLinkCode } from "./channels/telegram/link";
import { resolveTelegramEnv, telegramWebhookUrl } from "./env";
import { logEvent } from "./log";
import {
  TELEGRAM_ALREADY_CONNECTED_MESSAGE,
  TELEGRAM_NOT_CONFIGURED_MESSAGE,
  TELEGRAM_WEBHOOK_FAILED_MESSAGE,
} from "./reminders-copy";
import {
  disconnectTelegram,
  getSettings,
  readTelegramStatus,
  updateSchedule,
  type TelegramStatus,
} from "./settings";
import { updateReminderSettingsSchema, type ReminderSchedule } from "./settings-input";

const REMINDERS_PATH = "/settings/reminders";

export type TelegramLink = {
  /** `https://t.me/<bot>?start=<code>`: the one-use link (the code is only in it). */
  url: string;
  expiresAt: string;
};

const noInput = z.object({});

const connect = ownerAction(
  noInput,
  async (): Promise<ActionResult<TelegramLink>> => {
    const env = resolveTelegramEnv();
    if (!env.ok) return fail(TELEGRAM_NOT_CONFIGURED_MESSAGE);
    const db = getDb();
    if ((await getSettings(db)).telegramChatId !== null) {
      return fail(TELEGRAM_ALREADY_CONNECTED_MESSAGE);
    }

    // Registers (or refreshes) the webhook with the server's own token and secret.
    const client = createTelegramClient({ token: env.value.token, apiBase: env.value.apiBase });
    const registered = await client.setWebhook(
      telegramWebhookUrl(env.value),
      env.value.webhookSecret,
    );
    if (!registered.ok) {
      logEvent("warn", "telegram_set_webhook_failed", { kind: registered.kind });
      return fail(TELEGRAM_WEBHOOK_FAILED_MESSAGE);
    }

    const issued = await issueLinkCode(db, new Date());
    if (!issued) return fail(TELEGRAM_ALREADY_CONNECTED_MESSAGE);
    revalidatePath(REMINDERS_PATH);
    return ok({
      url: `https://t.me/${env.value.botUsername}?start=${issued.code}`,
      expiresAt: issued.expiresAt.toISOString(),
    });
  },
  { name: "connectTelegram" },
);

/** Registers the webhook and returns the link to open in Telegram (a new code each time). */
export async function connectTelegram(input: unknown): Promise<ActionResult<TelegramLink>> {
  return connect(input);
}

const disconnect = ownerAction(
  noInput,
  async (): Promise<ActionResult<TelegramStatus>> => {
    const db = getDb();
    await disconnectTelegram(db, "owner", new Date());
    revalidatePath(REMINDERS_PATH);
    return ok(await readTelegramStatus(db));
  },
  { name: "disconnectTelegram" },
);

/** Unlinks the chat and invalidates any pending link. */
export async function disconnectTelegramChat(
  input: unknown,
): Promise<ActionResult<TelegramStatus>> {
  return disconnect(input);
}

const readStatus = ownerAction(
  noInput,
  async (): Promise<ActionResult<TelegramStatus>> => ok(await readTelegramStatus(getDb())),
  { name: "readTelegramStatus" },
);

/** The Telegram state, polled by Ajustes while a link is waiting to be opened. */
export async function getTelegramStatus(input: unknown): Promise<ActionResult<TelegramStatus>> {
  return readStatus(input);
}

const update = ownerAction(
  updateReminderSettingsSchema,
  async (patch): Promise<ActionResult<ReminderSchedule>> => {
    const schedule = await updateSchedule(getDb(), patch);
    revalidatePath(REMINDERS_PATH);
    return ok(schedule);
  },
  { name: "updateReminderSettings" },
);

/**
 * Switches and times of the day's reminders and the Telegram amounts switch (one or more fields).
 * Returns the schedule as saved, so the screen shows what the server holds.
 */
export async function updateReminderSettings(
  input: unknown,
): Promise<ActionResult<ReminderSchedule>> {
  return update(input);
}
