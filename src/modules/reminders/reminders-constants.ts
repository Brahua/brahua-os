// Plain constants of `reminders` (SPEC-reminders). Client-safe: no database, no server-only.

/** Channels a reminder can go through: Telegram (R1) and push web (R5). */
export const CHANNEL_IDS = ["push", "telegram"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** The owner's "Canal de avisos" choice (SPEC-reminders "Pantallas"). */
export const DELIVERY_CHANNELS = ["push", "telegram", "both"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** What a reminder is about. Each one has its own switch in `reminder_settings`. */
export const REMINDER_KINDS = [
  "briefing",
  "payment_eve",
  "payment_followup",
  "evening_review",
  "habit_time",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const DELIVERY_STATUSES = ["pending", "sent", "skipped", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const CAPTURE_ENTITY_KINDS = ["task", "expense"] as const;
export type CaptureEntityKind = (typeof CAPTURE_ENTITY_KINDS)[number];

/** A reminder is sent until this long after its time; later it is `skipped` (a briefing at 14:00 is noise). */
export const GRACE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Sending attempts per reminder and channel, the first one included. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** `error_code` of a delivery whose chat can't be reached any more (Telegram 403). Never retried. */
export const UNREACHABLE_ERROR_CODE = "unreachable";
/** `error_code` of a delivery left `skipped` because its window had closed. */
export const WINDOW_EXPIRED_ERROR_CODE = "window_expired";
/** `error_code` of a delivery left `skipped` because there was nothing to say. */
export const EMPTY_ERROR_CODE = "empty";

/** Defaults of `reminder_settings` (Lima time, HH:MM). */
export const DEFAULT_BRIEFING_TIME = "07:30";
export const DEFAULT_EVENING_TIME = "21:00";

export const USER_AGENT_MAX_LENGTH = 200;

/** Push web: how long the push service keeps a message for an offline device (= the grace window, in seconds). */
export const PUSH_TTL_SECONDS = GRACE_WINDOW_MS / 1000;
/** Active devices the owner can have at once (a forged loop of subscriptions must not grow the table). */
export const PUSH_MAX_DEVICES = 10;
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;
/** Title of every notification; the body is the text of the reminder. */
export const PUSH_TITLE = "brahua-os";
/** The body is cut here (a push payload may hold 4 KB; a reminder is at most three short lines). */
export const PUSH_BODY_MAX_LENGTH = 400;

/** Telegram link codes: 8 characters from a 32-letter alphabet, 10 minutes, one use. */
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
/**
 * Wrong codes from ONE chat before that chat is ignored (for LINK_CHAT_WINDOW_MS). It never
 * touches the live codes: a third party must not be able to switch the owner's linking off.
 */
export const LINK_MAX_FAILED_ATTEMPTS = 5;
export const LINK_CHAT_WINDOW_MS = 60 * 60 * 1000;
/** Wrong codes from ANY chat in LINK_GLOBAL_WINDOW_MS before every attempt is answered "invalid". */
export const LINK_GLOBAL_MAX_ATTEMPTS = 30;
export const LINK_GLOBAL_WINDOW_MS = 10 * 60 * 1000;

/**
 * The `error_code`s of a `failed` delivery that the next tick may try again: the service answered
 * with an error, so nothing was sent (a server error, a bad request that may pass, a rate limit)
 * or the text was never built. AMBIGUOUS failures (`telegram_network`, `send_threw`: a timeout may
 * have delivered the message anyway) are NOT here: a duplicate reminder is worse than a missed one.
 */
export const RETRYABLE_ERROR_CODES: readonly string[] = [
  "telegram_server",
  "telegram_bad_request",
  "telegram_rate_limited",
  // Push web (R5): the push service answered with an error, so nothing was queued. `push_network`
  // (a timeout or a dropped connection) is ambiguous and stays out, like `telegram_network`.
  "push_server",
  "push_bad_request",
  "push_rate_limited",
  "build_failed",
];
