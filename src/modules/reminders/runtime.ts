// Builds the real channels and clients from the environment. The engine, the webhook and the
// actions receive them as dependencies (tests pass their own); this is the one place that reads
// the variables to build them.
import "server-only";
import type { ChannelId } from "./reminders-constants";
import type { ReminderChannel } from "./contracts";
import type { ReminderSettings } from "./db/schema";
import { createTelegramChannel } from "./channels/telegram/channel";
import { createTelegramClient, type TelegramClient } from "./channels/telegram/client";
import { resolveTelegramEnv, type TelegramEnv } from "./env";

/** The Telegram client for the environment, or null when a variable is missing or malformed. */
export function telegramClientFromEnv(
  env: TelegramEnv | null = readTelegramEnv(),
): TelegramClient | null {
  return env ? createTelegramClient({ token: env.token, apiBase: env.apiBase }) : null;
}

export function readTelegramEnv(): TelegramEnv | null {
  const resolved = resolveTelegramEnv();
  return resolved.ok ? resolved.value : null;
}

/**
 * The channels that can send right now. Telegram needs a connected chat and a valid
 * environment; push web (R5) will join here.
 */
export function channelsFromEnv(
  settings: ReminderSettings,
): Partial<Record<ChannelId, ReminderChannel>> {
  const channels: Partial<Record<ChannelId, ReminderChannel>> = {};
  const env = readTelegramEnv();
  if (env && settings.telegramChatId !== null) {
    channels.telegram = createTelegramChannel({
      client: createTelegramClient({ token: env.token, apiBase: env.apiBase }),
      chatId: settings.telegramChatId,
      appUrl: env.appOrigin,
    });
  }
  return channels;
}
