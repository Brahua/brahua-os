"use server";

// Server Actions of Ajustes → Avisos (R1: connect and disconnect Telegram; R2: the day's reminders). Each goes through
// ownerAction() (owner first, Zod, an ActionResult). "Conectar" registers the webhook with the
// bot token from the server's environment (nobody handles the token elsewhere) and issues the
// one-use link. The token and the webhook secret never reach the client or the logs.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { createTelegramClient } from "./channels/telegram/client";
import { issueLinkCode } from "./channels/telegram/link";
import { CHANNEL_COPY } from "./channel-copy";
import { resolveTelegramEnv, resolveVapidEnv, telegramWebhookUrl } from "./env";
import { logEvent } from "./log";
import { pushEndpointSchema, pushSubscriptionSchema } from "./push/push-input";
import {
  isPushEndpointActive,
  revokePushSubscription,
  savePushSubscription,
} from "./push/subscriptions";
import {
  TELEGRAM_ALREADY_CONNECTED_MESSAGE,
  TELEGRAM_NOT_CONFIGURED_MESSAGE,
  TELEGRAM_WEBHOOK_FAILED_MESSAGE,
} from "./reminders-copy";
import {
  disconnectTelegram,
  getSettings,
  readChannelSummary,
  readTelegramStatus,
  updateDeliveryChannel,
  updateSchedule,
  type ChannelSummary,
  type TelegramStatus,
} from "./settings";
import {
  updateDeliveryChannelSchema,
  updateReminderSettingsSchema,
  type ReminderSchedule,
} from "./settings-input";

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

// Push web and "Canal de avisos" (R5). The browser subscribes (it needs the user's gesture and the
// public key); these actions only record what it got. Subscriptions are never logged: endpoints
// and keys are secrets.

const subscribePush = ownerAction(
  pushSubscriptionSchema,
  async (subscription): Promise<ActionResult<ChannelSummary>> => {
    const db = getDb();
    if (!resolveVapidEnv().ok) return fail(CHANNEL_COPY.device.notConfigured);
    // Read from the request, not from the client: what the owner's browser really said.
    const userAgent = (await headers()).get("user-agent");
    const saved = await savePushSubscription(db, subscription, userAgent);
    if (saved === "too_many_devices") return fail(CHANNEL_COPY.device.tooMany);
    revalidatePath(REMINDERS_PATH);
    return ok(await readChannelSummary(db));
  },
  { name: "subscribePushDevice" },
);

/** Records this browser's push subscription (it starts receiving reminders). */
export async function subscribePushDevice(input: unknown): Promise<ActionResult<ChannelSummary>> {
  return subscribePush(input);
}

const unsubscribePush = ownerAction(
  pushEndpointSchema,
  async ({ endpoint }): Promise<ActionResult<ChannelSummary>> => {
    const db = getDb();
    await revokePushSubscription(db, endpoint, new Date());
    revalidatePath(REMINDERS_PATH);
    return ok(await readChannelSummary(db));
  },
  { name: "unsubscribePushDevice" },
);

/** Turns this browser's device off (its row is kept, revoked). */
export async function unsubscribePushDevice(input: unknown): Promise<ActionResult<ChannelSummary>> {
  return unsubscribePush(input);
}

const pushDeviceState = ownerAction(
  pushEndpointSchema,
  async ({ endpoint }): Promise<ActionResult<{ active: boolean }>> =>
    ok({ active: await isPushEndpointActive(getDb(), endpoint) }),
  { name: "getPushDeviceState" },
);

/** Whether this browser's subscription is one the server sends to (Ajustes asks on load). */
export async function getPushDeviceState(
  input: unknown,
): Promise<ActionResult<{ active: boolean }>> {
  return pushDeviceState(input);
}

const channelUpdate = ownerAction(
  updateDeliveryChannelSchema,
  async ({ deliveryChannel }): Promise<ActionResult<ChannelSummary>> => {
    const summary = await updateDeliveryChannel(getDb(), deliveryChannel);
    revalidatePath(REMINDERS_PATH);
    return ok(summary);
  },
  { name: "updateDeliveryChannel" },
);

/** Saves "Canal de avisos" (Push, Telegram or Ambos). */
export async function setDeliveryChannel(input: unknown): Promise<ActionResult<ChannelSummary>> {
  return channelUpdate(input);
}
