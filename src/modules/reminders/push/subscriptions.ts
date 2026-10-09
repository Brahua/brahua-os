// Push subscriptions in the database (SPEC-reminders "Modelo de datos": `push_subscriptions`).
// Server-only; callers have checked the owner (the actions) or are the engine. The keys are
// secrets: they never leave this file except into the push channel, and never into a log.
//
// A subscription is never deleted: the owner turning a device off, or a 404/410 from the push
// service, sets `revoked_at`. Subscribing the same endpoint again reactivates its row (and takes
// the new keys), so one browser is one row for good.
import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import type { PushDevice, PushDeviceStore } from "../channels/web-push/channel";
import { pushSubscriptions } from "../db/schema";
import { PUSH_MAX_DEVICES, USER_AGENT_MAX_LENGTH } from "../reminders-constants";
import type { PushSubscriptionInput } from "./push-input";

/** First key of the advisory lock `reminders` takes for push subscriptions (its namespace among the app's locks). */
const PUSH_ADVISORY_SPACE = 6_000;
/** Second key: the cap on active devices (count + insert must not interleave). */
const PUSH_DEVICES_KEY = "reminders:push_devices";

export type SaveSubscriptionResult = "saved" | "too_many_devices";

/** Saves (or reactivates) the browser's subscription. `userAgent` is cut to what the column allows. */
export async function savePushSubscription(
  db: Database,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<SaveSubscriptionResult> {
  const agent = userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null;
  return db.transaction(async (tx): Promise<SaveSubscriptionResult> => {
    // Two-key advisory lock, the FIRST lock of the transaction (never taken after a row lock):
    // without it two simultaneous activations both count 9 devices and both insert the tenth and
    // eleventh. It is released with the transaction.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${sql.raw(String(PUSH_ADVISORY_SPACE))}, hashtext(${PUSH_DEVICES_KEY}))`,
    );
    // A cap on OTHER active devices: re-subscribing a known endpoint always works.
    const [others] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(
        and(isNull(pushSubscriptions.revokedAt), ne(pushSubscriptions.endpoint, input.endpoint)),
      );
    if ((others?.count ?? 0) >= PUSH_MAX_DEVICES) return "too_many_devices";

    await tx
      .insert(pushSubscriptions)
      .values({
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: agent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: agent,
          revokedAt: null,
        },
      });
    return "saved";
  });
}

/** Turns a device off (kept, revoked). True when it was active. */
export async function revokePushSubscription(
  db: Database,
  endpoint: string,
  now: Date,
): Promise<boolean> {
  const revoked = await db
    .update(pushSubscriptions)
    .set({ revokedAt: now })
    .where(and(eq(pushSubscriptions.endpoint, endpoint), isNull(pushSubscriptions.revokedAt)))
    .returning({ id: pushSubscriptions.id });
  return revoked.length > 0;
}

/** Whether this endpoint is a device that receives reminders now. */
export async function isPushEndpointActive(db: Database, endpoint: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), isNull(pushSubscriptions.revokedAt)));
  return row !== undefined;
}

/** What Ajustes lists: no endpoint, no keys. */
export type PushDeviceRow = { id: string; userAgent: string | null; createdAt: Date };

export async function listActivePushDevices(db: Database): Promise<PushDeviceRow[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.revokedAt))
    .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
}

/** The channel's view of the table. */
export function createPushDeviceStore(db: Database): PushDeviceStore {
  return {
    async listActive(): Promise<PushDevice[]> {
      return db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(isNull(pushSubscriptions.revokedAt))
        .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
    },
    async revoke(id): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({ revokedAt: new Date() })
        .where(and(eq(pushSubscriptions.id, id), isNull(pushSubscriptions.revokedAt)));
    },
    async markSuccess(ids): Promise<void> {
      if (ids.length === 0) return;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(inArray(pushSubscriptions.id, ids));
    },
  };
}
