// Reads and writes of the single `reminder_settings` row (SPEC-reminders "Modelo de datos"), and
// the state Ajustes shows. Server-only: callers have already checked the owner (a page's
// `requireOwner()`, an action's `ownerAction()`) or are the authenticated tick/webhook.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { formatOwnerDay } from "@/lib/time";
import { pushSubscriptions, reminderSettings, telegramLinkCodes } from "./db/schema";
import { resolveTelegramEnv } from "./env";
import type { ReminderSettings } from "./db/schema";

/** Creates the one settings row with its defaults the first time (never overwrites it). */
export async function ensureSettings(db: Database): Promise<void> {
  await db.insert(reminderSettings).values({}).onConflictDoNothing();
}

/** The settings row, created with its defaults when it does not exist yet. */
export async function getSettings(db: Database): Promise<ReminderSettings> {
  await ensureSettings(db);
  const [row] = await db.select().from(reminderSettings).where(eq(reminderSettings.id, true));
  return row;
}

/** Push subscriptions that were not revoked (R5 fills them; today there are none). */
export async function countActivePushDevices(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.revokedAt));
  return row?.count ?? 0;
}

/**
 * Disconnects the Telegram chat and invalidates every live link code, in one transaction under
 * the settings row lock (the same one a code redemption takes, so the two never interleave).
 * `blocked` records that Telegram refused (403) so Ajustes can say so; `owner` clears it. With
 * `expectedChatId` it only acts if that chat is still the linked one (returns whether it did).
 */
export async function disconnectTelegram(
  db: Database,
  reason: "owner" | "blocked",
  now: Date,
  expectedChatId?: number,
): Promise<boolean> {
  await ensureSettings(db);
  return db.transaction(async (tx) => {
    await tx.select().from(reminderSettings).where(eq(reminderSettings.id, true)).for("update");
    const changed = await tx
      .update(reminderSettings)
      .set({
        telegramChatId: null,
        linkedAt: null,
        telegramBlockedAt: reason === "blocked" ? now : null,
      })
      .where(
        expectedChatId === undefined
          ? eq(reminderSettings.id, true)
          : and(eq(reminderSettings.id, true), eq(reminderSettings.telegramChatId, expectedChatId)),
      )
      .returning({ id: reminderSettings.id });
    // A late answer about another chat (it was unlinked and B linked meanwhile) changes nothing.
    if (changed.length === 0) return false;
    await tx.update(telegramLinkCodes).set({ usedAt: now }).where(isNull(telegramLinkCodes.usedAt));
    return true;
  });
}

/** What Ajustes → Avisos shows about Telegram. */
export type TelegramStatus = {
  state: "disconnected" | "connected" | "blocked";
  /** "3 oct. 2026" when connected. */
  linkedLabel: string | null;
  /** The bot can't be connected until these variables are set on the server (names only). */
  configured: boolean;
  problems: string[];
};

/** `undefined` = the row does not exist yet: a fresh install, not connected. */
export function telegramStatusOf(settings: ReminderSettings | undefined): TelegramStatus {
  const env = resolveTelegramEnv();
  const connected = settings?.telegramChatId != null;
  return {
    state: connected ? "connected" : settings?.telegramBlockedAt ? "blocked" : "disconnected",
    linkedLabel:
      settings?.linkedAt && connected ? formatOwnerDay(settings.linkedAt, "short") : null,
    configured: env.ok,
    problems: env.ok ? [] : env.problems,
  };
}

/** The status for Ajustes (and for the action that polls it while a link is pending). */
export async function readTelegramStatus(db: Database): Promise<TelegramStatus> {
  // Read only (no INSERT): the status is polled and shown on page loads.
  const [row] = await db.select().from(reminderSettings).where(eq(reminderSettings.id, true));
  return telegramStatusOf(row);
}
