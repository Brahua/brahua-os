// Constants of the email suggestions (SPEC-finance-email). Plain values, no server-only: the schema,
// the Zod input and the tests share them.

/** The banks whose notifications are read (SPEC-finance-email: only BCP and BBVA; Yape pays too). */
export const EMAIL_SOURCES = ["bcp", "bbva", "yape"] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];

/** What the email was about: a card purchase, a Yape payment or a transfer to someone. */
export const EMAIL_KINDS = ["card", "yape", "transfer"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** `unreadable`: a known sender and subject whose body no rule understood ("No pude leerlo"). */
export const SUGGESTION_STATUSES = ["pending", "registered", "dismissed", "unreadable"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Gmail message ids are hex strings of 16 characters; accept a safe range, never free text. */
export const GMAIL_MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const SUGGESTION_MERCHANT_MAX_LENGTH = 80;
export const SUGGESTION_SUBJECT_MAX_LENGTH = 120;
export const CARD_LAST4 = /^[0-9]{4}$/;

/** The whole request is at most this big (a 413 is not retried by the script: it chunks). */
export const MAX_INGEST_BODY_BYTES = 128 * 1024;
/** The script sends the plain text cut to this (the legal footers are not needed). */
export const MAX_EMAIL_TEXT_LENGTH = 8 * 1024;
// 10 emails of 8 KB fit the body limit with room for JSON escaping; the script sends in chunks.
export const MAX_MESSAGES_PER_BATCH = 10;

/** The merchants a recurring payment remembers from the emails that paid it (the oldest leaves). */
export const EMAIL_ALIASES_MAX_ITEMS = 10;

/** "Mis nombres" (Ajustes): the names that mean "my own account" (SPEC-finance-email). */
export const OWN_NAMES_MAX_ITEMS = 10;
export const OWN_NAME_MAX_LENGTH = 80;
