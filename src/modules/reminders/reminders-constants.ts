// Plain constants of `reminders` (SPEC-reminders). Client-safe: no database, no server-only.

/** Channels a reminder can go through. R1 implements `telegram`; `push` arrives in R5. */
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

/** Telegram link codes: 8 characters from a 32-letter alphabet, 10 minutes, one use. */
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
/** After this many wrong codes the live codes are invalidated and the owner asks for a new one. */
export const LINK_MAX_FAILED_ATTEMPTS = 5;
