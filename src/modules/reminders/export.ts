// Tables `reminders` offers to `pnpm db:export` (src/lib/data-export.ts): the settings, the
// deliveries, the Telegram updates seen and the captures. `telegram_link_codes` and
// `push_subscriptions` are left out on purpose (they carry secrets and are recreated by connecting
// Telegram and activating the device): see REMINDERS_EXCLUDED_TABLES. The weekly `pg_dump` has them.
import type { ExportableTable } from "@/lib/data-export";
import {
  reminderDeliveries,
  reminderSettings,
  telegramCaptures,
  telegramUpdates,
} from "./db/schema";

export const remindersExportTables: ExportableTable[] = [
  { table: reminderSettings, orderBy: [reminderSettings.id] },
  { table: reminderDeliveries, orderBy: [reminderDeliveries.createdAt, reminderDeliveries.id] },
  { table: telegramUpdates, orderBy: [telegramUpdates.updateId] },
  { table: telegramCaptures, orderBy: [telegramCaptures.createdAt, telegramCaptures.id] },
];

/**
 * Never exported: they hold secrets (link-code hashes, push endpoints and keys) or are throttling
 * records (`telegram_link_attempts`).
 */
export const REMINDERS_EXCLUDED_TABLES: readonly string[] = [
  "telegram_link_codes",
  "telegram_link_attempts",
  "push_subscriptions",
];
