// Telegram as a ReminderChannel (the only implementation in R1; push web joins in R5).
import "server-only";
import type { ChannelSendResult, ReminderChannel } from "../../contracts";
import { UNREACHABLE_ERROR_CODE } from "../../reminders-constants";
import type { TelegramClient } from "./client";

/**
 * Sends a reminder to the linked chat: its text, then the link to the app. `appUrl` is the
 * public origin (https://os.brahua.com in production).
 */
export function createTelegramChannel(options: {
  client: TelegramClient;
  chatId: number;
  appUrl: string;
}): ReminderChannel {
  const { client, chatId, appUrl } = options;
  return {
    id: "telegram",
    async send(message): Promise<ChannelSendResult> {
      const result = await client.sendMessage({ chatId, text: `${message.text}\n${appUrl}` });
      if (result.ok) return { ok: true, messageId: result.result.messageId };
      // 403: the bot was blocked or removed. The chat is gone for good; the engine disconnects it.
      if (result.kind === "forbidden") {
        return { ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true };
      }
      return { ok: false, code: `telegram_${result.kind}` };
    },
  };
}
