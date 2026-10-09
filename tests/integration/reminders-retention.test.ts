// @vitest-environment node
// Retention of the Telegram bookkeeping: old `telegram_updates` and `telegram_link_attempts` go, recent
// ones stay, and an update that a capture references is kept (the capture needs it).
import { describe, expect, test } from "vitest";
import {
  telegramCaptures,
  telegramLinkAttempts,
  telegramUpdates,
} from "@/modules/reminders/db/schema";
import { purgeTelegramHistory } from "@/modules/reminders/retention";
import { testDb } from "./test-db";

const NOW = new Date("2026-10-08T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("purgeTelegramHistory", () => {
  test("removes what is older than 30 days and keeps the rest (and what a capture needs)", async () => {
    await testDb.insert(telegramUpdates).values([
      { updateId: 1, createdAt: daysAgo(31) },
      { updateId: 2, createdAt: daysAgo(40) },
      { updateId: 3, createdAt: daysAgo(29) },
      { updateId: 4, createdAt: daysAgo(35) },
    ]);
    await testDb.insert(telegramCaptures).values({
      updateId: 4,
      entityKind: "task",
      entityId: "00000000-0000-4000-8000-000000000001",
    });
    await testDb.insert(telegramLinkAttempts).values([
      { chatId: 7, createdAt: daysAgo(31) },
      { chatId: 7, createdAt: daysAgo(1) },
    ]);

    expect(await purgeTelegramHistory(testDb, NOW)).toEqual({ updates: 2, attempts: 1 });
    const left = await testDb.select().from(telegramUpdates);
    expect(left.map((row) => row.updateId).sort()).toEqual([3, 4]);
    expect(await testDb.select().from(telegramLinkAttempts)).toHaveLength(1);
    expect(await testDb.select().from(telegramCaptures)).toHaveLength(1);
  });

  test("on empty tables it does nothing", async () => {
    expect(await purgeTelegramHistory(testDb, NOW)).toEqual({ updates: 0, attempts: 0 });
  });
});
