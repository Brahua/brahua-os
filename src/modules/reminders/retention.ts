// Retention of the Telegram bookkeeping (SPEC-reminders "Retención"). `telegram_updates` grows with
// every update claimed (the owner's messages, and any stranger's `/start <code>`-shaped one);
// `telegram_link_attempts` with every wrong code. Both are only useful for minutes (Telegram
// retries for hours; the throttles look back an hour), so rows older than 30 days go. An update
// that has a `telegram_captures` row stays (the capture references it).
import "server-only";
import { lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { telegramCaptures, telegramLinkAttempts, telegramUpdates } from "./db/schema";

export const TELEGRAM_RETENTION_DAYS = 30;

/** Deletes the old rows; returns how many of each went. Called by the tick, after its work. */
export async function purgeTelegramHistory(
  db: Database,
  now: Date,
): Promise<{ updates: number; attempts: number }> {
  const cutoff = new Date(now.getTime() - TELEGRAM_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const updates = await db
    .delete(telegramUpdates)
    .where(
      sql`${lt(telegramUpdates.createdAt, cutoff)} and not exists (select 1 from ${telegramCaptures} where ${telegramCaptures.updateId} = ${telegramUpdates.updateId})`,
    )
    .returning({ id: telegramUpdates.updateId });
  const attempts = await db
    .delete(telegramLinkAttempts)
    .where(lt(telegramLinkAttempts.createdAt, cutoff))
    .returning({ id: telegramLinkAttempts.id });
  return { updates: updates.length, attempts: attempts.length };
}
