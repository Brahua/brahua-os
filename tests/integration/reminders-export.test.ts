// R1.1 of `reminders`: what `pnpm db:export` takes from the new tables. The settings, deliveries,
// Telegram updates and captures are exported; the link codes and the push subscriptions (secrets
// that connecting and activating the device recreate) never are.
import { describe, expect, test } from "vitest";
import { buildExport } from "@/lib/data-export";
import {
  pushSubscriptions,
  reminderDeliveries,
  telegramCaptures,
  telegramLinkCodes,
  telegramUpdates,
} from "@/modules/reminders/db/schema";
import { getSettings } from "@/modules/reminders/settings";
import { testDb } from "./test-db";

const NOW = new Date("2026-10-08T12:00:00Z");
const ENDPOINT = "https://push.example.test/send/very-secret-endpoint";
const P256DH = "p256dh-key-value-should-never-leave";
const AUTH = "auth-secret-value-should-never-leave";
const CODE_HASH = "d".repeat(64);

describe("export of the reminders tables", () => {
  test("includes the four tables and leaves out the two with secrets", async () => {
    await getSettings(testDb);
    await testDb.insert(reminderDeliveries).values({
      kind: "briefing",
      channel: "telegram",
      dedupeKey: "briefing:2026-10-08",
      scheduledFor: NOW,
      status: "sent",
      attempts: 1,
    });
    await testDb.insert(telegramUpdates).values({ updateId: 1 });
    await testDb.insert(telegramCaptures).values({
      updateId: 1,
      entityKind: "task",
      entityId: "00000000-0000-4000-8000-000000000001",
    });
    await testDb
      .insert(telegramLinkCodes)
      .values({ codeHash: CODE_HASH, expiresAt: new Date(NOW.getTime() + 600_000) });
    await testDb
      .insert(pushSubscriptions)
      .values({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, userAgent: "iPhone" });

    const data = await buildExport(testDb, NOW);

    expect(data.tables.reminder_settings.rowCount).toBe(1);
    expect(data.tables.reminder_deliveries.rowCount).toBe(1);
    expect(data.tables.telegram_updates.rowCount).toBe(1);
    expect(data.tables.telegram_captures.rowCount).toBe(1);
    expect(data.tables).not.toHaveProperty("telegram_link_codes");
    expect(data.tables).not.toHaveProperty("push_subscriptions");
    expect(data.excludedTables).toEqual(
      expect.arrayContaining(["telegram_link_codes", "push_subscriptions"]),
    );

    const json = JSON.stringify(data);
    for (const secret of [CODE_HASH, ENDPOINT, P256DH, AUTH]) {
      expect(json).not.toContain(secret);
    }
  });
});
