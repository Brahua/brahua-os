// The delivery log and the claim (SPEC-reminders "Idempotencia"). One row per reminder and channel,
// unique on `(dedupe_key, channel)`: the engine INSERTS the row first (ON CONFLICT DO NOTHING) and
// only the tick that got it sends, so two ticks at once, or a rerun of the workflow, send once.
//
// A row is at-most-once by design: if a tick dies between the claim and the send, the reminder is
// not sent again (a missed reminder beats a duplicate). Only a `failed` row, the service having
// answered with an error, is claimed again, up to MAX_DELIVERY_ATTEMPTS and never when the chat
// is unreachable. The table never stores the text of a reminder or its amounts.
import "server-only";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { reminderDeliveries } from "./db/schema";
import {
  MAX_DELIVERY_ATTEMPTS,
  UNREACHABLE_ERROR_CODE,
  type ChannelId,
  type ReminderKind,
} from "./reminders-constants";

export type DeliveryTarget = {
  kind: ReminderKind;
  channel: ChannelId;
  dedupeKey: string;
  scheduledFor: Date;
};

/**
 * Claims a reminder for a channel: the id of the row this caller now owns (the first attempt, or a
 * retry of a failed one), or null when someone else has it or it is settled.
 */
export async function claimDelivery(db: Database, target: DeliveryTarget): Promise<string | null> {
  const inserted = await db
    .insert(reminderDeliveries)
    .values({ ...target, status: "pending", attempts: 1 })
    .onConflictDoNothing({ target: [reminderDeliveries.dedupeKey, reminderDeliveries.channel] })
    .returning({ id: reminderDeliveries.id });
  if (inserted[0]) return inserted[0].id;

  // The row exists. Only a failed one with attempts left is taken again (the UPDATE re-checks the
  // status under the row lock, so two ticks can't both win it).
  const retried = await db
    .update(reminderDeliveries)
    .set({ status: "pending", attempts: sql`${reminderDeliveries.attempts} + 1` })
    .where(
      and(
        eq(reminderDeliveries.dedupeKey, target.dedupeKey),
        eq(reminderDeliveries.channel, target.channel),
        eq(reminderDeliveries.status, "failed"),
        lt(reminderDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
        or(
          isNull(reminderDeliveries.errorCode),
          ne(reminderDeliveries.errorCode, UNREACHABLE_ERROR_CODE),
        ),
      ),
    )
    .returning({ id: reminderDeliveries.id });
  return retried[0]?.id ?? null;
}

/** Records a reminder that will not be sent (window closed, nothing to say). True if it is new. */
export async function recordSkipped(
  db: Database,
  target: DeliveryTarget,
  errorCode: string,
): Promise<boolean> {
  const inserted = await db
    .insert(reminderDeliveries)
    .values({ ...target, status: "skipped", attempts: 0, errorCode })
    .onConflictDoNothing({ target: [reminderDeliveries.dedupeKey, reminderDeliveries.channel] })
    .returning({ id: reminderDeliveries.id });
  return inserted.length > 0;
}

export async function markSkipped(db: Database, id: string, errorCode: string): Promise<void> {
  await db
    .update(reminderDeliveries)
    .set({ status: "skipped", errorCode })
    .where(eq(reminderDeliveries.id, id));
}

export async function markSent(
  db: Database,
  id: string,
  now: Date,
  messageId?: number,
): Promise<void> {
  await db
    .update(reminderDeliveries)
    .set({
      status: "sent",
      sentAt: now,
      errorCode: null,
      telegramMessageId: messageId !== undefined && Number.isFinite(messageId) ? messageId : null,
    })
    .where(eq(reminderDeliveries.id, id));
}

export async function markFailed(db: Database, id: string, errorCode: string): Promise<void> {
  await db
    .update(reminderDeliveries)
    .set({ status: "failed", errorCode })
    .where(eq(reminderDeliveries.id, id));
}
