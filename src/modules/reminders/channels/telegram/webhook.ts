// The Telegram webhook (SPEC-reminders "Bot de Telegram"): authenticate, bound the body,
// deduplicate by `update_id`, link the chat with `/start <code>` (R1) and, for the linked chat
// only, capture text, run the commands and undo (R3).
//
// Order matters: the secret header is checked BEFORE the body is read (a caller without it gets a
// 401 and costs nothing), the body is size-bounded, and an update is claimed by `update_id` in the
// same transaction that handles it. That transaction also creates the task or expense and its
// `telegram_captures` row, so a failure rolls ALL of it back and Telegram's retry is not mistaken
// for a duplicate, nor leaves a half-captured message. Only the linked chat's messages and
// `/start <code>`-shaped ones are claimed at all; only a valid `/start <code>` is answered to a
// stranger (and a wrong one is not); everything else from an unknown chat gets a bare 200 and
// nothing is stored. Replies go out AFTER the commit: a failed reply never undoes a capture (and
// is not retried: a duplicate "Gasto: …" is worse than a missing one). Logs carry no chat ids, no
// text, no codes, no amounts.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { describeError } from "@/lib/describe-error";
import { collectBriefingFacts } from "../../briefing-source";
import {
  listReminderSources,
  type BotCapture,
  type BotCaptureKind,
  type BotCaptured,
  type ReminderSource,
} from "../../contracts";
import { reminderSettings, telegramCaptures, telegramUpdates } from "../../db/schema";
import { isWebhookAuthorized } from "../../env";
import { logEvent } from "../../log";
import { briefingText } from "../../messages";
import { getSettings } from "../../settings";
import type { InlineButton, TelegramClient } from "./client";
import { classifyMessage } from "./classify";
import {
  BOT_EXPENSE_USAGE_MESSAGE,
  BOT_HELP_MESSAGE,
  BOT_INVALID_MESSAGE,
  BOT_LINKED_MESSAGE,
  BOT_NO_AMOUNT_MESSAGE,
  BOT_NON_TEXT_MESSAGE,
  BOT_TASK_USAGE_MESSAGE,
  BOT_TODAY_EMPTY_MESSAGE,
  BOT_TODAY_FAILED_MESSAGE,
  BOT_TOO_LONG_EXPENSE_MESSAGE,
  BOT_TOO_LONG_TASK_MESSAGE,
  BOT_UNDO_BUTTON,
  BOT_UNDO_CHANGED_MESSAGE,
  BOT_UNDO_GONE_MESSAGE,
  BOT_UNDONE_MESSAGE,
  BOT_UNKNOWN_COMMAND_MESSAGE,
  expenseCapturedReply,
  taskCapturedReply,
} from "./copy";
import { parseStartCommand, redeemLinkCodeIn } from "./link";

/** Telegram updates are a few KB; anything bigger is not Telegram. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** The "Deshacer" button's callback data: `u:` and the id of the `telegram_captures` row. */
export const UNDO_CALLBACK_PREFIX = "u:";
const UNDO_CALLBACK = /^u:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const chatSchema = z.object({ id: z.number().int(), type: z.string() });

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: chatSchema,
      text: z.string().max(4096).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().min(1).max(128),
      from: z.object({ id: z.number().int() }),
      data: z.string().max(64).optional(),
      message: z.object({ chat: chatSchema }).optional(),
    })
    .optional(),
});

export type WebhookDeps = {
  db: Database;
  client: TelegramClient;
  now: Date;
  /** Creates and undoes what the owner captures (composition root `src/lib/bot-capture.ts`). */
  capture: BotCapture;
  /** Where the secret is read from (process.env by default). */
  env?: Record<string, string | undefined>;
  /** The reminder sources `/hoy` reads (the registry by default; the route registers them). */
  sources?: () => readonly ReminderSource[];
  /** The app's public origin, appended to `/hoy` (as the reminders do). */
  appUrl?: string;
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

type Reply = { text: string; buttons?: readonly InlineButton[] };

type Outcome =
  | { kind: "duplicate" }
  | { kind: "ignored" }
  | { kind: "linked"; chatId: number }
  /** A message to send to the chat; `changed` refreshes the screens of what was created. */
  | { kind: "reply"; chatId: number; reply: Reply; changed?: BotCaptureKind; label: string }
  /** `/hoy`: built after the commit (a failing source must not roll the claim back). */
  | { kind: "today"; chatId: number; showAmounts: boolean }
  /** The answer to a tap on "Deshacer". */
  | { kind: "callback"; callbackId: string; text: string; changed?: BotCaptureKind };

/** A transaction handle. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function failureText(kind: BotCaptureKind, reason: Extract<BotCaptured, { ok: false }>["reason"]) {
  if (reason === "no_amount") return BOT_NO_AMOUNT_MESSAGE;
  if (reason === "too_long") {
    return kind === "task" ? BOT_TOO_LONG_TASK_MESSAGE : BOT_TOO_LONG_EXPENSE_MESSAGE;
  }
  return BOT_INVALID_MESSAGE;
}

/**
 * The linked chat's message, inside the transaction that claimed it. Reads the settings row
 * FOR SHARE: a disconnect or a new link waits until this transaction ends, so "the linked chat" is
 * the same chat from the check to the commit. (The `/start <code>` path takes the row FOR UPDATE
 * on its own and never gets here, so the two locks are never upgraded one into the other.)
 */
async function handleLinkedMessage(
  tx: Tx,
  deps: WebhookDeps,
  update: { updateId: number; chatId: number; text: string | undefined },
): Promise<Outcome> {
  const [settings] = await tx
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.id, true))
    .for("share");
  const { chatId, text } = update;
  // Disconnected or re-linked to another chat since the first look: not ours any more.
  if (settings?.telegramChatId !== chatId) return { kind: "ignored" };

  const reply = (body: string, label: string): Outcome => ({
    kind: "reply",
    chatId,
    reply: { text: body },
    label,
  });
  if (text === undefined) return reply(BOT_NON_TEXT_MESSAGE, "non_text");

  const intent = classifyMessage(text);
  switch (intent.kind) {
    case "ignore":
      return { kind: "ignored" };
    case "start":
    case "help":
      return reply(BOT_HELP_MESSAGE, "help");
    case "unknown_command":
      return reply(BOT_UNKNOWN_COMMAND_MESSAGE, "unknown_command");
    case "usage":
      return reply(
        intent.capture === "task" ? BOT_TASK_USAGE_MESSAGE : BOT_EXPENSE_USAGE_MESSAGE,
        "usage",
      );
    case "today":
      return { kind: "today", chatId, showAmounts: settings.showAmountsTelegram };
    case "capture": {
      // The transaction handle stands in for the database: the data layers only need its query
      // methods and `transaction` (a savepoint here).
      const created = await deps.capture.create(tx as unknown as Database, {
        kind: intent.capture,
        text: intent.text,
        now: deps.now,
      });
      if (!created.ok) return reply(failureText(intent.capture, created.reason), "capture_refused");
      const [row] = await tx
        .insert(telegramCaptures)
        .values({
          updateId: update.updateId,
          entityKind: created.kind,
          entityId: created.entityId,
        })
        .returning({ id: telegramCaptures.id });
      return {
        kind: "reply",
        chatId,
        reply: {
          text:
            created.kind === "task"
              ? taskCapturedReply(created.title, created.dueLabel)
              : expenseCapturedReply(created.amountLabel, created.description),
          buttons: [{ text: BOT_UNDO_BUTTON, callbackData: `${UNDO_CALLBACK_PREFIX}${row.id}` }],
        },
        changed: created.kind,
        label: `captured_${created.kind}`,
      };
    }
  }
}

/** A tap on "Deshacer": undoes exactly the entity of that capture, unless it changed. */
async function handleUndo(
  tx: Tx,
  deps: WebhookDeps,
  callback: { id: string; fromId: number; data: string | undefined },
): Promise<Outcome> {
  const [settings] = await tx
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.id, true))
    .for("share");
  if (settings?.telegramChatId !== callback.fromId) return { kind: "ignored" };

  const answer = (text: string, changed?: BotCaptureKind): Outcome => ({
    kind: "callback",
    callbackId: callback.id,
    text,
    ...(changed ? { changed } : {}),
  });
  const captureId = callback.data ? UNDO_CALLBACK.exec(callback.data)?.[1] : undefined;
  if (!captureId) return answer(BOT_UNDO_GONE_MESSAGE);
  const [capture] = await tx
    .select()
    .from(telegramCaptures)
    .where(eq(telegramCaptures.id, captureId));
  if (!capture) return answer(BOT_UNDO_GONE_MESSAGE);

  const result = await deps.capture.undo(tx as unknown as Database, {
    kind: capture.entityKind,
    entityId: capture.entityId,
  });
  if (result === "undone") return answer(BOT_UNDONE_MESSAGE, capture.entityKind);
  return answer(result === "changed" ? BOT_UNDO_CHANGED_MESSAGE : BOT_UNDO_GONE_MESSAGE);
}

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
    const tap = update.callback_query;
    const fromLinkedChat =
      incoming?.chat.type === "private" && linkedChat !== null && incoming.chat.id === linkedChat;
    const startShaped =
      incoming?.chat.type === "private" &&
      incoming.text !== undefined &&
      parseStartCommand(incoming.text) !== null;
    // A tap counts when it comes from the linked user and, if Telegram says where, from the
    // linked private chat (in a private chat the user's id is the chat's id).
    const tapFromLinkedChat =
      tap !== undefined &&
      linkedChat !== null &&
      tap.from.id === linkedChat &&
      (tap.message === undefined ||
        (tap.message.chat.type === "private" && tap.message.chat.id === linkedChat));
    if (!fromLinkedChat && !startShaped && !tapFromLinkedChat) return respond(200);

    outcome = await deps.db.transaction(async (tx): Promise<Outcome> => {
      const claimed = await tx
        .insert(telegramUpdates)
        .values({ updateId: update.update_id })
        .onConflictDoNothing()
        .returning({ updateId: telegramUpdates.updateId });
      if (claimed.length === 0) return { kind: "duplicate" };

      if (tap !== undefined) {
        return handleUndo(tx, deps, { id: tap.id, fromId: tap.from.id, data: tap.data });
      }
      if (!incoming) return { kind: "ignored" };

      // `/start <code>` links (or, from the linked chat, is just a greeting).
      const code = incoming.text === undefined ? null : parseStartCommand(incoming.text);
      if (code !== null) {
        const result = await redeemLinkCodeIn(tx, {
          code,
          chatId: incoming.chat.id,
          now: deps.now,
        });
        if (result === "linked") return { kind: "linked", chatId: incoming.chat.id };
        return result === "already-linked" && fromLinkedChat
          ? {
              kind: "reply",
              chatId: incoming.chat.id,
              reply: { text: BOT_HELP_MESSAGE },
              label: "help",
            }
          : { kind: "ignored" };
      }
      if (!fromLinkedChat) return { kind: "ignored" };
      return handleLinkedMessage(tx, deps, {
        updateId: update.update_id,
        chatId: incoming.chat.id,
        text: incoming.text,
      });
    });
  } catch (error) {
    logEvent("error", "telegram_webhook_failed", describeError(error));
    // 500: Telegram retries, and the rollback released the update_id and whatever was created.
    return respond(500);
  }

  // 4. After the commit. A failure here is logged and never retried.
  await finish(deps, outcome);
  return respond(200);
}

/** Refreshes the screens of what changed; a failure is logged, never fatal. */
function refreshScreens(deps: WebhookDeps, kind: BotCaptureKind) {
  try {
    deps.capture.revalidate(kind);
  } catch (error) {
    logEvent("warn", "telegram_revalidate_failed", describeError(error));
  }
}

async function finish(deps: WebhookDeps, outcome: Outcome): Promise<void> {
  const { client } = deps;
  switch (outcome.kind) {
    case "duplicate":
    case "ignored":
      return;
    case "linked": {
      const sent = await client.sendMessage({ chatId: outcome.chatId, text: BOT_LINKED_MESSAGE });
      logEvent(sent.ok ? "info" : "warn", "telegram_linked", {
        reply: sent.ok ? "sent" : sent.kind,
      });
      return;
    }
    case "reply": {
      if (outcome.changed) refreshScreens(deps, outcome.changed);
      const sent = await client.sendMessage({
        chatId: outcome.chatId,
        text: outcome.reply.text,
        ...(outcome.reply.buttons ? { buttons: outcome.reply.buttons } : {}),
      });
      logEvent(sent.ok ? "info" : "warn", "telegram_reply", {
        what: outcome.label,
        reply: sent.ok ? "sent" : sent.kind,
      });
      return;
    }
    case "today": {
      let text: string;
      try {
        const sources = (deps.sources ?? listReminderSources)();
        const facts = await collectBriefingFacts(sources, deps.now);
        const body = briefingText(facts, outcome.showAmounts) ?? BOT_TODAY_EMPTY_MESSAGE;
        text = deps.appUrl ? `${body}\n${deps.appUrl}` : body;
      } catch (error) {
        logEvent("error", "telegram_today_failed", describeError(error));
        text = BOT_TODAY_FAILED_MESSAGE;
      }
      const sent = await client.sendMessage({ chatId: outcome.chatId, text });
      logEvent(sent.ok ? "info" : "warn", "telegram_reply", {
        what: "today",
        reply: sent.ok ? "sent" : sent.kind,
      });
      return;
    }
    case "callback": {
      if (outcome.changed) refreshScreens(deps, outcome.changed);
      const answered = await client.answerCallbackQuery(outcome.callbackId, outcome.text);
      logEvent(answered.ok ? "info" : "warn", "telegram_undo", {
        reply: answered.ok ? "sent" : answered.kind,
      });
      return;
    }
  }
}
