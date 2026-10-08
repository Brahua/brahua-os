// The Telegram webhook (SPEC-reminders "Bot de Telegram"), R1 part: authenticate, bound the body,
// deduplicate by `update_id` and handle `/start <code>` (linking). Capture and the commands arrive
// in R3 on top of this handler.
//
// Order matters: the secret header is checked BEFORE the body is read (a caller without it gets a
// 401 and costs nothing), the body is size-bounded, and an update is claimed by `update_id` in the
// same transaction that handles it, so a failure rolls both back and Telegram's retry is not
// mistaken for a duplicate. Only the linked chat's messages and `/start <code>`-shaped ones are
// claimed at all; only a valid `/start <code>` is answered; everything else from an unknown chat
// gets a bare 200 and nothing is stored. Logs carry no chat ids, no text, no codes.
import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { describeError } from "@/lib/describe-error";
import { telegramUpdates } from "../../db/schema";
import { isWebhookAuthorized } from "../../env";
import { logEvent } from "../../log";
import { getSettings } from "../../settings";
import type { TelegramClient } from "./client";
import { BOT_LINKED_MESSAGE } from "./copy";
import { parseStartCommand, redeemLinkCodeIn } from "./link";

/** Telegram updates are a few KB; anything bigger is not Telegram. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});

export type WebhookDeps = {
  db: Database;
  client: TelegramClient;
  now: Date;
  /** Where the secret is read from (process.env by default). */
  env?: Record<string, string | undefined>;
};

const respond = (status: number) => new Response(null, { status });

/** Reads the body up to `limit` bytes; null when it is bigger. */
async function readBounded(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Outcome = { kind: "duplicate" } | { kind: "ignored" } | { kind: "linked"; chatId: number };

export async function handleTelegramWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  // 1. Authenticate before looking at anything else.
  if (!isWebhookAuthorized(request.headers.get(WEBHOOK_SECRET_HEADER), deps.env ?? process.env)) {
    return respond(401);
  }

  // 2. Bounded body, valid JSON, a shape we know. Unknown update types are simply ignored (200),
  // so Telegram does not retry them.
  const raw = await readBounded(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) return respond(413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return respond(400);
  }
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return respond(200);
  const update = parsed.data;

  // 3. Claim the update and handle it in one transaction, but only an update that can matter: one
  // from the linked chat, or shaped like `/start <code>`. Anything else (a stranger's chatter, an
  // edit, a poll) gets a bare 200 and leaves no row, so strangers cannot grow `telegram_updates`.
  let outcome: Outcome;
  try {
    const linkedChat = (await getSettings(deps.db)).telegramChatId;
    const incoming = update.message;
    const relevant =
      incoming?.chat.type === "private" &&
      (incoming.chat.id === linkedChat ||
        (incoming.text !== undefined && parseStartCommand(incoming.text) !== null));
    if (!relevant) return respond(200);

    outcome = await deps.db.transaction(async (tx): Promise<Outcome> => {
      const claimed = await tx
        .insert(telegramUpdates)
        .values({ updateId: update.update_id })
        .onConflictDoNothing()
        .returning({ updateId: telegramUpdates.updateId });
      if (claimed.length === 0) return { kind: "duplicate" };

      const message = update.message;
      // Only private chats, only text.
      if (!message?.text || message.chat.type !== "private") return { kind: "ignored" };

      const code = parseStartCommand(message.text);
      if (code === null) return { kind: "ignored" }; // R3: the linked chat's capture and commands.

      const result = await redeemLinkCodeIn(tx, { code, chatId: message.chat.id, now: deps.now });
      return result === "linked"
        ? { kind: "linked", chatId: message.chat.id }
        : { kind: "ignored" };
    });
  } catch (error) {
    logEvent("error", "telegram_webhook_failed", describeError(error));
    // 500: Telegram retries, and the rollback released the update_id.
    return respond(500);
  }

  // 4. The only reply in R1: the chat is linked. A failure to send it does not undo the link.
  if (outcome.kind === "linked") {
    const sent = await deps.client.sendMessage({
      chatId: outcome.chatId,
      text: BOT_LINKED_MESSAGE,
    });
    logEvent(sent.ok ? "info" : "warn", "telegram_linked", { reply: sent.ok ? "sent" : sent.kind });
  }
  return respond(200);
}
