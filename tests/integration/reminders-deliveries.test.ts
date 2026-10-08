// @vitest-environment node
// reminders → claimDelivery against Postgres: which failed deliveries the next tick may take again.
// Only a failure that provably sent nothing is retried; an ambiguous one (a timeout: the message
// may have arrived) and an unreachable chat never are, so a duplicate reminder cannot come from a
// retry.
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { claimDelivery, markFailed, type DeliveryTarget } from "@/modules/reminders/deliveries";
import { reminderDeliveries } from "@/modules/reminders/db/schema";
import {
  MAX_DELIVERY_ATTEMPTS,
  RETRYABLE_ERROR_CODES,
} from "@/modules/reminders/reminders-constants";
import { testDb } from "./test-db";

const TARGET: DeliveryTarget = {
  kind: "briefing",
  channel: "telegram",
  dedupeKey: "briefing:2026-10-08",
  scheduledFor: new Date("2026-10-08T12:30:00Z"),
};

async function failedWith(errorCode: string, attempts = 1) {
  const id = await claimDelivery(testDb, TARGET);
  if (!id) throw new Error("first claim lost");
  await markFailed(testDb, id, errorCode);
  await testDb.update(reminderDeliveries).set({ attempts }).where(eq(reminderDeliveries.id, id));
  return id;
}

describe("claimDelivery", () => {
  test("the first claim wins, a second one loses while it is pending or sent", async () => {
    const id = await claimDelivery(testDb, TARGET);
    expect(id).not.toBeNull();
    expect(await claimDelivery(testDb, TARGET)).toBeNull();
    await testDb.update(reminderDeliveries).set({ status: "sent" });
    expect(await claimDelivery(testDb, TARGET)).toBeNull();
  });

  test.each(RETRYABLE_ERROR_CODES)("a failure `%s` is claimed again (attempt 2)", async (code) => {
    const id = await failedWith(code);
    expect(await claimDelivery(testDb, TARGET)).toBe(id);
    const [row] = await testDb.select().from(reminderDeliveries);
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
  });

  test.each([
    "telegram_network",
    "send_threw",
    "unreachable",
    "telegram_unauthorized",
    "push_gone",
  ])("an ambiguous or final failure `%s` is NEVER claimed again", async (code) => {
    await failedWith(code);
    expect(await claimDelivery(testDb, TARGET)).toBeNull();
    const [row] = await testDb.select().from(reminderDeliveries);
    expect(row).toMatchObject({ status: "failed", attempts: 1, errorCode: code });
  });

  test(`a retryable failure stops being retried at ${MAX_DELIVERY_ATTEMPTS} attempts`, async () => {
    await failedWith("telegram_server", MAX_DELIVERY_ATTEMPTS);
    expect(await claimDelivery(testDb, TARGET)).toBeNull();
    // One attempt less is still retried (positive control).
    await testDb.update(reminderDeliveries).set({ attempts: MAX_DELIVERY_ATTEMPTS - 1 });
    expect(await claimDelivery(testDb, TARGET)).not.toBeNull();
  });

  test("two claims at once on a failed retryable delivery: exactly one wins", async () => {
    await failedWith("telegram_server");
    const results = await Promise.all([
      claimDelivery(testDb, TARGET),
      claimDelivery(testDb, TARGET),
    ]);
    expect(results.filter((id) => id !== null)).toHaveLength(1);
  });

  test("a skipped delivery is never claimed again", async () => {
    const id = await claimDelivery(testDb, TARGET);
    await testDb
      .update(reminderDeliveries)
      .set({ status: "skipped", errorCode: "empty" })
      .where(eq(reminderDeliveries.id, id!));
    expect(await claimDelivery(testDb, TARGET)).toBeNull();
  });
});
