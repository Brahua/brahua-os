// POST /api/telegram/webhook: where Telegram delivers the bot's updates (SPEC-reminders "Bot de
// Telegram"). `handleTelegramWebhook` authenticates the secret header before reading the body.
// Registered with `setWebhook` by the "Conectar" button in Ajustes → Avisos.
import { getDb } from "@/lib/db";
import { handleTelegramWebhook } from "@/modules/reminders/channels/telegram/webhook";
import type { TelegramClient } from "@/modules/reminders/channels/telegram/client";
import { telegramClientFromEnv } from "@/modules/reminders/runtime";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Used when the bot's variables are not set: the update is handled, the reply just can't go. */
const OFFLINE_CLIENT: TelegramClient = {
  sendMessage: async () => ({ ok: false, kind: "unauthorized" }),
  answerCallbackQuery: async () => ({ ok: false, kind: "unauthorized" }),
  setWebhook: async () => ({ ok: false, kind: "unauthorized" }),
};

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, {
    db: getDb(),
    client: telegramClientFromEnv() ?? OFFLINE_CLIENT,
    now: new Date(),
  });
}
