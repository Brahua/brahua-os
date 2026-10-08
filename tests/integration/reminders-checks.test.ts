// R1.1 of `reminders`: the CHECKs, unique indexes and foreign keys of the six tables, with raw
// inserts (defense in depth behind Zod: scripts, raw SQL or a bug can't store an invalid row).
import { eq, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import {
  pushSubscriptions,
  reminderDeliveries,
  reminderSettings,
  telegramCaptures,
  telegramLinkCodes,
  telegramUpdates,
} from "@/modules/reminders/db/schema";
import { getSettings } from "@/modules/reminders/settings";
import { testDb } from "./test-db";

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const check = (constraint: string) => ({ code: "23514", constraint });
const unique = (constraint: string) => ({ code: "23505", constraint });

describe("reminder_settings", () => {
  test("the first read creates the one row with its defaults", async () => {
    const settings = await getSettings(testDb);
    expect(settings).toMatchObject({
      id: true,
      deliveryChannel: "push",
      briefingEnabled: true,
      briefingTime: "07:30:00",
      paymentsEnabled: true,
      eveningEnabled: true,
      eveningTime: "21:00:00",
      habitTimesEnabled: true,
      showAmountsTelegram: true,
      showAmountsPush: false,
      telegramChatId: null,
      linkedAt: null,
      telegramBlockedAt: null,
    });
  });

  test("reading it again never creates a second row nor resets a change", async () => {
    await getSettings(testDb);
    await testDb.update(reminderSettings).set({ briefingTime: "08:00" });
    await getSettings(testDb);
    const rows = await testDb.select().from(reminderSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].briefingTime).toBe("08:00:00");
  });

  test("a second row is rejected (id = true plus the primary key)", async () => {
    await getSettings(testDb);
    expect(
      await violation(() => testDb.execute(sql`insert into reminder_settings (id) values (false)`)),
    ).toEqual(check("reminder_settings_single_row_check"));
    expect(
      await violation(() => testDb.execute(sql`insert into reminder_settings (id) values (true)`)),
    ).toEqual(unique("reminder_settings_pkey"));
  });

  test("an unknown delivery channel is rejected", async () => {
    await getSettings(testDb);
    expect(
      await violation(() =>
        testDb.execute(sql`update reminder_settings set delivery_channel = 'email'`),
      ),
    ).toEqual(check("reminder_settings_delivery_channel_check"));
    for (const channel of ["push", "telegram", "both"]) {
      expect(
        await violation(() =>
          testDb.execute(sql`update reminder_settings set delivery_channel = ${channel}`),
        ),
      ).toBeNull();
    }
  });

  test("a time with seconds is rejected", async () => {
    await getSettings(testDb);
    expect(
      await violation(() =>
        testDb.execute(sql`update reminder_settings set briefing_time = '07:30:15'`),
      ),
    ).toEqual(check("reminder_settings_times_check"));
    expect(
      await violation(() =>
        testDb.execute(sql`update reminder_settings set evening_time = '21:00:01'`),
      ),
    ).toEqual(check("reminder_settings_times_check"));
    expect(
      await violation(() =>
        testDb.execute(sql`update reminder_settings set evening_time = '23:59'`),
      ),
    ).toBeNull();
  });

  test("a chat needs its linked_at, and blocked only makes sense disconnected", async () => {
    await getSettings(testDb);
    expect(
      await violation(() =>
        testDb.execute(sql`update reminder_settings set telegram_chat_id = 42`),
      ),
    ).toEqual(check("reminder_settings_link_check"));
    expect(
      await violation(() => testDb.execute(sql`update reminder_settings set linked_at = now()`)),
    ).toEqual(check("reminder_settings_link_check"));
    expect(
      await violation(() =>
        testDb.execute(
          sql`update reminder_settings set telegram_chat_id = 42, linked_at = now(), telegram_blocked_at = now()`,
        ),
      ),
    ).toEqual(check("reminder_settings_link_check"));
    // Connected, and disconnected-but-blocked, are fine (positive controls).
    expect(
      await violation(() =>
        testDb.execute(
          sql`update reminder_settings set telegram_chat_id = 42, linked_at = now(), telegram_blocked_at = null`,
        ),
      ),
    ).toBeNull();
    expect(
      await violation(() =>
        testDb.execute(
          sql`update reminder_settings set telegram_chat_id = null, linked_at = null, telegram_blocked_at = now()`,
        ),
      ),
    ).toBeNull();
  });

  test("a Telegram chat id beyond 32 bits is stored (bigint)", async () => {
    await getSettings(testDb);
    await testDb
      .update(reminderSettings)
      .set({ telegramChatId: 5_000_000_000, linkedAt: new Date() })
      .where(eq(reminderSettings.id, true));
    const [row] = await testDb.select().from(reminderSettings);
    expect(row.telegramChatId).toBe(5_000_000_000);
  });
});

describe("reminder_deliveries", () => {
  const delivery =
    (values: Record<string, unknown> = {}) =>
    () =>
      testDb.insert(reminderDeliveries).values({
        kind: "briefing",
        channel: "telegram",
        dedupeKey: "briefing:2026-10-08",
        scheduledFor: new Date("2026-10-08T12:30:00Z"),
        ...values,
      } as typeof reminderDeliveries.$inferInsert);

  test("starts pending with no attempts", async () => {
    await delivery()();
    const [row] = await testDb.select().from(reminderDeliveries);
    expect(row).toMatchObject({ status: "pending", attempts: 0, sentAt: null, errorCode: null });
  });

  test("(dedupe_key, channel) is unique, but another channel or key is fine", async () => {
    await delivery()();
    expect(await violation(delivery())).toEqual(
      unique("reminder_deliveries_dedupe_channel_unique"),
    );
    expect(await violation(delivery({ channel: "push" }))).toBeNull();
    expect(await violation(delivery({ dedupeKey: "briefing:2026-10-09" }))).toBeNull();
  });

  test("an unknown kind, channel or status, or negative attempts, is rejected", async () => {
    expect(await violation(delivery({ kind: "promo" }))).toEqual(
      check("reminder_deliveries_kind_check"),
    );
    expect(await violation(delivery({ channel: "email" }))).toEqual(
      check("reminder_deliveries_channel_check"),
    );
    expect(await violation(delivery({ status: "done" }))).toEqual(
      check("reminder_deliveries_status_check"),
    );
    expect(await violation(delivery({ attempts: -1 }))).toEqual(
      check("reminder_deliveries_attempts_check"),
    );
  });

  test("every kind of the contract is accepted", async () => {
    for (const kind of [
      "briefing",
      "payment_eve",
      "payment_followup",
      "evening_review",
      "habit_time",
    ]) {
      expect(await violation(delivery({ kind, dedupeKey: `${kind}:k` }))).toBeNull();
    }
  });
});

describe("telegram_link_codes", () => {
  test("a code hash is unique and attempts never go negative", async () => {
    const values = { codeHash: "a".repeat(64), expiresAt: new Date("2026-10-08T12:40:00Z") };
    await testDb.insert(telegramLinkCodes).values(values);
    expect(await violation(() => testDb.insert(telegramLinkCodes).values(values))).toEqual(
      unique("telegram_link_codes_code_hash_unique"),
    );
    expect(
      await violation(() =>
        testDb
          .insert(telegramLinkCodes)
          .values({ ...values, codeHash: "b".repeat(64), failedAttempts: -1 }),
      ),
    ).toEqual(check("telegram_link_codes_attempts_check"));
  });
});

describe("push_subscriptions", () => {
  const subscription =
    (values: Record<string, unknown> = {}) =>
    () =>
      testDb.insert(pushSubscriptions).values({
        endpoint: "https://push.example.test/send/abc",
        p256dh: "p256dh-key",
        auth: "auth-secret",
        ...values,
      } as typeof pushSubscriptions.$inferInsert);

  test("the endpoint is unique", async () => {
    await subscription()();
    expect(await violation(subscription())).toEqual(unique("push_subscriptions_endpoint_unique"));
  });

  test("the user agent is at most 200 characters", async () => {
    expect(await violation(subscription({ userAgent: "x".repeat(201) }))).toEqual(
      check("push_subscriptions_user_agent_check"),
    );
    expect(
      await violation(
        subscription({ endpoint: "https://push.example.test/other", userAgent: "x".repeat(200) }),
      ),
    ).toBeNull();
  });
});

describe("telegram_updates and telegram_captures", () => {
  test("an update id is stored once", async () => {
    await testDb.insert(telegramUpdates).values({ updateId: 7_000_000_001 });
    expect(
      await violation(() => testDb.insert(telegramUpdates).values({ updateId: 7_000_000_001 })),
    ).toEqual(unique("telegram_updates_pkey"));
  });

  test("a capture needs its update, one capture per update, and a known entity kind", async () => {
    const entityId = "00000000-0000-4000-8000-000000000001";
    const orphan = await violation(() =>
      testDb.insert(telegramCaptures).values({ updateId: 1, entityKind: "task", entityId }),
    );
    expect(orphan?.code).toBe("23503");

    await testDb.insert(telegramUpdates).values({ updateId: 1 });
    await testDb.insert(telegramCaptures).values({ updateId: 1, entityKind: "task", entityId });
    expect(
      await violation(() =>
        testDb.insert(telegramCaptures).values({ updateId: 1, entityKind: "expense", entityId }),
      ),
    ).toEqual(unique("telegram_captures_update_id_unique"));

    await testDb.insert(telegramUpdates).values({ updateId: 2 });
    expect(
      await violation(() =>
        testDb.insert(telegramCaptures).values({
          updateId: 2,
          entityKind: "note",
          entityId,
        } as unknown as typeof telegramCaptures.$inferInsert),
      ),
    ).toEqual(check("telegram_captures_entity_kind_check"));
  });
});
