// The Telegram Bot API behind an interface (SPEC-reminders "Bot de Telegram"): the engine, the
// webhook and the actions depend on `TelegramClient`, never on `fetch`. The base URL comes from
// the environment (`TELEGRAM_API_BASE`, the official API by default) so tests point it at a fake
// server on localhost: there are no test branches in this file.
//
// The token is part of the URL path. It is never put in an error, a log line or a result: every
// failure is reduced to a `kind` and, for rate limits, `retryAfter`.

/** Why a call failed, without anything the service said. */
export type TelegramFailureKind =
  /** 403: the bot was blocked by the user, or kicked from the chat. */
  | "forbidden"
  /** 401/404 on the bot itself: the token is wrong or revoked. */
  | "unauthorized"
  | "rate_limited"
  | "bad_request"
  | "server"
  | "network";

export type TelegramResult<T = true> =
  { ok: true; result: T } | { ok: false; kind: TelegramFailureKind; retryAfter?: number };

export type InlineButton = { text: string; callbackData: string };

export type SendMessageInput = {
  chatId: number;
  text: string;
  /** One row of inline buttons (e.g. "Deshacer"). */
  buttons?: readonly InlineButton[];
};

export type TelegramClient = {
  sendMessage(input: SendMessageInput): Promise<TelegramResult<{ messageId: number }>>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramResult>;
  setWebhook(url: string, secretToken: string): Promise<TelegramResult>;
};

export type TelegramClientOptions = {
  token: string;
  /** No trailing slash. */
  apiBase: string;
  /** Injectable for tests; the global `fetch` otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;

type ApiBody = {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  parameters?: { retry_after?: number };
};

function kindOfStatus(status: number): TelegramFailureKind {
  if (status === 403) return "forbidden";
  if (status === 401 || status === 404) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const { token, apiBase } = options;
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    method: string,
    payload: Record<string, unknown>,
    pick: (result: unknown) => T,
  ): Promise<TelegramResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        // The token is in the URL: never follow a redirect to somewhere else with it.
        redirect: "error",
      });
    } catch {
      // The error of a failed fetch can carry the URL (and so the token): drop it.
      return { ok: false, kind: "network" };
    }
    let body: ApiBody = {};
    try {
      body = (await response.json()) as ApiBody;
    } catch {
      // Not JSON: judged by the status alone.
    }
    if (response.ok && body.ok === true) return { ok: true, result: pick(body.result) };
    const status = body.error_code ?? response.status;
    const retryAfter = body.parameters?.retry_after;
    return {
      ok: false,
      kind: kindOfStatus(status),
      ...(typeof retryAfter === "number" ? { retryAfter } : {}),
    };
  }

  return {
    sendMessage({ chatId, text, buttons }) {
      return call(
        "sendMessage",
        {
          chat_id: chatId,
          text,
          // The reminder is the message: no preview card for the app link.
          link_preview_options: { is_disabled: true },
          ...(buttons && buttons.length > 0
            ? {
                reply_markup: {
                  inline_keyboard: [
                    buttons.map((button) => ({
                      text: button.text,
                      callback_data: button.callbackData,
                    })),
                  ],
                },
              }
            : {}),
        },
        (result) => ({ messageId: Number((result as { message_id?: number } | null)?.message_id) }),
      );
    },
    answerCallbackQuery(callbackQueryId, text) {
      return call(
        "answerCallbackQuery",
        { callback_query_id: callbackQueryId, ...(text ? { text } : {}) },
        () => true as const,
      );
    },
    setWebhook(url, secretToken) {
      return call(
        "setWebhook",
        {
          url,
          secret_token: secretToken,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: false,
        },
        () => true as const,
      );
    },
  };
}
