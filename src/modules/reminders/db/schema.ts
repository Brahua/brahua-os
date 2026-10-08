import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CAPTURE_ENTITY_KINDS,
  CHANNEL_IDS,
  DEFAULT_BRIEFING_TIME,
  DEFAULT_EVENING_TIME,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  REMINDER_KINDS,
  USER_AGENT_MAX_LENGTH,
} from "../reminders-constants";

export {
  CAPTURE_ENTITY_KINDS,
  CHANNEL_IDS,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  REMINDER_KINDS,
} from "../reminders-constants";

// `reminders` depends on `core` only (CAPABILITY-MAP, SPEC-reminders "Contratos"). Six tables in
// one additive migration (R1): the single settings row, the Telegram link codes, the push
// subscriptions (filled in R5), the deliveries (one row per reminder and channel: the claim that
// makes a send happen once), the Telegram updates already seen and the captures "Deshacer" needs
// (filled in R3). `habits.reminder_time` and `daypart` come with R4.
//
// Defense in depth behind the Zod schemas: raw SQL, scripts or a bug can't store a second
// settings row, an unknown channel, kind or status, or a time with seconds.

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

export const reminderSettings = pgTable(
  "reminder_settings",
  {
    // The only row: `id = true` plus a CHECK, so a second one can't exist.
    id: boolean("id").primaryKey().default(true),
    deliveryChannel: text("delivery_channel", { enum: DELIVERY_CHANNELS })
      .notNull()
      .default("push"),
    briefingEnabled: boolean("briefing_enabled").notNull().default(true),
    // Hours in Lima, HH:MM (no seconds: CHECKed below).
    briefingTime: time("briefing_time").notNull().default(DEFAULT_BRIEFING_TIME),
    paymentsEnabled: boolean("payments_enabled").notNull().default(true),
    eveningEnabled: boolean("evening_enabled").notNull().default(true),
    eveningTime: time("evening_time").notNull().default(DEFAULT_EVENING_TIME),
    habitTimesEnabled: boolean("habit_times_enabled").notNull().default(true),
    showAmountsTelegram: boolean("show_amounts_telegram").notNull().default(true),
    // Amounts show on the lock screen: off unless the owner asks.
    showAmountsPush: boolean("show_amounts_push").notNull().default(false),
    // The one chat the bot talks to and listens to. Null = not connected.
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    // Set when Telegram answered 403 (the owner blocked the bot): the chat is disconnected and
    // Ajustes says why. Cleared on the next connection.
    telegramBlockedAt: timestamp("telegram_blocked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check("reminder_settings_single_row_check", sql`${table.id} = true`),
    check(
      "reminder_settings_delivery_channel_check",
      sql`${table.deliveryChannel} in (${sqlList(DELIVERY_CHANNELS)})`,
    ),
    check(
      "reminder_settings_times_check",
      sql`extract(second from ${table.briefingTime}) = 0 and extract(second from ${table.eveningTime}) = 0`,
    ),
    // Connected means a chat and the moment it was linked; blocked only makes sense disconnected.
    check(
      "reminder_settings_link_check",
      sql`(${table.telegramChatId} is null) = (${table.linkedAt} is null) and (${table.telegramBlockedAt} is null or ${table.telegramChatId} is null)`,
    ),
  ],
);

export const telegramLinkCodes = pgTable("telegram_link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // SHA-256 of the code, never the code itself.
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Used or invalidated (a new code, a disconnect). Rows are kept.
  // "One live code" is kept by link.ts under the settings row lock, not by an index.
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per wrong `/start <code>` attempt, by chat. Guessing a code is limited per chat (5 in an
// hour: that chat is then ignored) and globally (30 in 10 minutes: every attempt is answered
// "invalid"), and NEITHER closes the owner's live code: a third party must not be able to switch
// the linking off. Throttling records, not exported; never stores the code that was tried.
export const telegramLinkAttempts = pgTable(
  "telegram_link_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("telegram_link_attempts_chat_created_idx").on(table.chatId, table.createdAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull().unique(),
    // The keys are secrets: never in logs, never exported.
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // For showing "iPhone" in Ajustes.
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    // A 404/410 from the push service revokes the subscription (kept, not deleted).
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "push_subscriptions_user_agent_check",
      sql`${table.userAgent} is null or char_length(${table.userAgent}) <= ${n(USER_AGENT_MAX_LENGTH)}`,
    ),
  ],
);

export const reminderDeliveries = pgTable(
  "reminder_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: REMINDER_KINDS }).notNull(),
    channel: text("channel", { enum: CHANNEL_IDS }).notNull(),
    // `briefing:2026-10-08`, `payment_eve:<id>:<dueOn>`, …: what makes a reminder one reminder.
    dedupeKey: text("dedupe_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    // The claim: the engine inserts first (ON CONFLICT DO NOTHING) and only the one that got the
    // row sends. Never stores the text or the amounts of a reminder.
    uniqueIndex("reminder_deliveries_dedupe_channel_unique").on(table.dedupeKey, table.channel),
    index("reminder_deliveries_scheduled_for_idx").on(table.scheduledFor),
    check("reminder_deliveries_kind_check", sql`${table.kind} in (${sqlList(REMINDER_KINDS)})`),
    check("reminder_deliveries_channel_check", sql`${table.channel} in (${sqlList(CHANNEL_IDS)})`),
    check(
      "reminder_deliveries_status_check",
      sql`${table.status} in (${sqlList(DELIVERY_STATUSES)})`,
    ),
    check("reminder_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const telegramUpdates = pgTable("telegram_updates", {
  // Telegram retries a webhook that didn't answer 2xx: this is what stops a message from being
  // handled twice.
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const telegramCaptures = pgTable(
  "telegram_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    updateId: bigint("update_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => telegramUpdates.updateId, { onDelete: "restrict" }),
    entityKind: text("entity_kind", { enum: CAPTURE_ENTITY_KINDS }).notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "telegram_captures_entity_kind_check",
      sql`${table.entityKind} in (${sqlList(CAPTURE_ENTITY_KINDS)})`,
    ),
  ],
);

export type ReminderSettings = typeof reminderSettings.$inferSelect;
export type ReminderDelivery = typeof reminderDeliveries.$inferSelect;
