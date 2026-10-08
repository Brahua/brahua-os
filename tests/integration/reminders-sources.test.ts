// @vitest-environment node
// R2 of `reminders`: the real sources (`finance`, `habits`, `tasks` and the briefing) against
// Postgres, and the engine with the four registered at once. A reminder never goes out for a paid,
// skipped, archived or deleted payment, a done or paused habit, or an empty day; two ticks at the
// same time send ONE briefing (with a positive control: another day sends another); the amounts
// switch decides whether the text carries an amount. Telegram is replaced by a recording channel:
// what is under test is what the sources say and when (the real client is in
// reminders-engine.test.ts).
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ensureReminderSources, SOURCES } from "@/lib/reminder-sources";
import {
  financeExpenses,
  financeRecurringPayments,
  financeSettlements,
} from "@/modules/finance/db/schema";
import { selectUpcomingPayments } from "@/modules/finance/contracts";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { financeReminderSource } from "@/modules/finance/reminders-source";
import type {
  ChannelSendResult,
  ReminderChannel,
  ReminderContext,
} from "@/modules/reminders/contracts";
import { reminderDeliveries, reminderSettings } from "@/modules/reminders/db/schema";
import { runTick } from "@/modules/reminders/engine";
import { getSettings } from "@/modules/reminders/settings";
import { addDaysToKey, limaDayOf, limaInstant } from "@/modules/reminders/slots";
import { tasks } from "@/modules/tasks/db/schema";
import { testDb } from "./test-db";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const CHAT_ID = 5_000_000_042;

/** 07:35 in Lima on Thursday 2026-10-08: 5 minutes into the default briefing's window. */
const MORNING = limaInstant("2026-10-08", "07:35");
const EVENING = limaInstant("2026-10-08", "21:05");

beforeEach(async () => {
  ensureReminderSources();
  await getSettings(testDb);
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: CHAT_ID, linkedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(reminderSettings.id, true));
});

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

type NewRecurring = Partial<typeof financeRecurringPayments.$inferInsert> & { name: string };

/** A monthly payment of S/ 50 on `dayOfMonth`, starting 2026-10-01 (so only October's period exists). */
async function recurring(values: NewRecurring & { dayOfMonth: number }) {
  const [row] = await testDb
    .insert(financeRecurringPayments)
    .values({
      amountCents: 5_000,
      currency: "PEN",
      cycle: "monthly",
      startDate: "2026-10-01",
      ...values,
    })
    .returning();
  return row;
}

async function settle(recurringId: string, dueOn: string, status: "paid" | "skipped") {
  if (status === "skipped") {
    await testDb
      .insert(financeSettlements)
      .values({ recurringPaymentId: recurringId, dueOn, status });
    return;
  }
  const [expense] = await testDb
    .insert(financeExpenses)
    .values({
      amountCents: 5_000,
      currency: "PEN",
      spentOn: dueOn,
      recurringPaymentId: recurringId,
      recurringDueOn: dueOn,
    })
    .returning();
  await testDb
    .insert(financeSettlements)
    .values({ recurringPaymentId: recurringId, dueOn, status, expenseId: expense.id });
}

let order = 0;
async function habit(values: Partial<typeof habits.$inferInsert> & { name: string }) {
  const [row] = await testDb
    .insert(habits)
    .values({
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-01",
      sortOrder: order++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

const task = (values: Partial<typeof tasks.$inferInsert> & { title: string }) =>
  testDb.insert(tasks).values(values);

/** The engine's context for an instant in Lima, like `runTick` builds it. */
function context(now: Date): ReminderContext {
  const today = limaDayOf(now);
  return {
    now,
    today,
    yesterday: addDaysToKey(today, -1),
    times: { briefing: "07:30", evening: "21:00" },
  };
}

// ---------------------------------------------------------------------------------------------
// finance
// ---------------------------------------------------------------------------------------------

describe("finance: getUpcomingPayments (selectUpcomingPayments)", () => {
  test("pending periods in the range, with the contract's shape; nothing paid, skipped, archived or deleted", async () => {
    const pending = await recurring({ name: "Netflix", dayOfMonth: 9 });
    const paid = await recurring({ name: "Pagado", dayOfMonth: 9 });
    const skipped = await recurring({ name: "Omitido", dayOfMonth: 9 });
    await recurring({
      name: "Archivado",
      dayOfMonth: 9,
      archivedAt: new Date("2026-10-02T00:00:00Z"),
    });
    await recurring({
      name: "Eliminado",
      dayOfMonth: 9,
      deletedAt: new Date("2026-10-02T00:00:00Z"),
    });
    await recurring({ name: "Otro día", dayOfMonth: 12 });
    await settle(paid.id, "2026-10-09", "paid");
    await settle(skipped.id, "2026-10-09", "skipped");

    expect(await selectUpcomingPayments(testDb, "2026-10-09", "2026-10-09", "2026-10-08")).toEqual([
      {
        recurringId: pending.id,
        name: "Netflix",
        dueOn: "2026-10-09",
        amountCents: 5_000,
        currency: "PEN",
      },
    ]);
    // Positive control: the range reaches the others.
    const wide = await selectUpcomingPayments(testDb, "2026-10-01", "2026-10-31", "2026-10-08");
    expect(wide.map((payment) => payment.name).sort()).toEqual(["Netflix", "Otro día"]);
  });

  test("a variable payment has no amount; both ends of the range are included", async () => {
    await recurring({ name: "Luz", dayOfMonth: 9, amountCents: null });
    await recurring({ name: "Agua", dayOfMonth: 10 });
    const items = await selectUpcomingPayments(testDb, "2026-10-09", "2026-10-10", "2026-10-08");
    expect(items.map((item) => [item.name, item.amountCents])).toEqual([
      ["Luz", null],
      ["Agua", 5_000],
    ]);
  });
});

describe("finance: the reminder source", () => {
  test("the eve exists for a pending payment; a paid, skipped, archived or deleted one has none", async () => {
    const pending = await recurring({ name: "Netflix", dayOfMonth: 9 });
    const paid = await recurring({ name: "Pagado", dayOfMonth: 9 });
    const skipped = await recurring({ name: "Omitido", dayOfMonth: 9 });
    await recurring({
      name: "Archivado",
      dayOfMonth: 9,
      archivedAt: new Date("2026-10-02T00:00:00Z"),
    });
    await recurring({
      name: "Eliminado",
      dayOfMonth: 9,
      deletedAt: new Date("2026-10-02T00:00:00Z"),
    });
    await settle(paid.id, "2026-10-09", "paid");
    await settle(skipped.id, "2026-10-09", "skipped");

    const candidates = await financeReminderSource.candidates(context(MORNING));
    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      `payment_eve:${pending.id}:2026-10-09`,
    ]);
  });

  test("the follow-up exists 3 days after, only while the period is still pending", async () => {
    const pending = await recurring({ name: "Netflix", dayOfMonth: 5 });
    const paid = await recurring({ name: "Pagado", dayOfMonth: 5 });
    const skipped = await recurring({ name: "Omitido", dayOfMonth: 5 });
    await settle(paid.id, "2026-10-05", "paid");
    await settle(skipped.id, "2026-10-05", "skipped");

    const candidates = await financeReminderSource.candidates(context(MORNING));
    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      `payment_followup:${pending.id}:2026-10-05`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// habits
// ---------------------------------------------------------------------------------------------

describe("habits: the evening review", () => {
  test("names the habits left; a done, paused or «a evitar» habit is not one of them", async () => {
    await habit({ name: "Leer" });
    const done = await habit({ name: "Meditar" });
    const paused = await habit({ name: "Yoga" });
    await habit({ name: "No fumar", kind: "avoid" });
    await testDb
      .insert(habitLogs)
      .values({ habitId: done, day: "2026-10-08", quantity: 1, target: 1 });
    await testDb
      .insert(habitPauses)
      .values({ habitId: paused, startDate: "2026-10-07", endDate: "2026-10-09" });

    const [review] = await SOURCES.find((source) => source.id === "habits")!.candidates(
      context(EVENING),
    );
    expect(review.dedupeKey).toBe("evening:2026-10-08");
    expect(await review.build({ channel: "telegram", showAmounts: true })).toBe(
      "Te queda Leer. Si lo haces ahora, cuenta hoy.",
    );
  });

  test("with every habit met there is nothing to say", async () => {
    const id = await habit({ name: "Leer" });
    await testDb
      .insert(habitLogs)
      .values({ habitId: id, day: "2026-10-08", quantity: 1, target: 1 });
    const [review] = await SOURCES.find((source) => source.id === "habits")!.candidates(
      context(EVENING),
    );
    expect(await review.build({ channel: "telegram", showAmounts: true })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// the engine with every source registered
// ---------------------------------------------------------------------------------------------

/** A channel that records what it is asked to send; `delayMs` makes two ticks really overlap. */
function recordingChannel(delayMs = 0) {
  const sent: { text: string; dedupeKey: string }[] = [];
  const channel: ReminderChannel = {
    id: "telegram",
    send: async (message): Promise<ChannelSendResult> => {
      sent.push({ text: message.text, dedupeKey: message.dedupeKey });
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ok: true, messageId: sent.length };
    },
  };
  return { channel, sent };
}

function tick(now: Date, channel: ReminderChannel) {
  return runTick({ db: testDb, now, sources: SOURCES, channelsFor: () => ({ telegram: channel }) });
}

const deliveries = () =>
  testDb.select().from(reminderDeliveries).orderBy(reminderDeliveries.dedupeKey);

const setSettings = (values: Partial<typeof reminderSettings.$inferInsert>) =>
  testDb.update(reminderSettings).set(values).where(eq(reminderSettings.id, true));

/** A day with a habit to do, a task due and a payment due: the story's briefing. */
async function busyDay() {
  await habit({ name: "Leer" });
  await task({ title: "pilas", dueDate: "2026-10-08" });
  await recurring({ name: "Netflix", dayOfMonth: 8 });
}

describe("the briefing through the engine", () => {
  test("sends the story's line once, from the three modules", async () => {
    await busyDay();
    const { channel, sent } = recordingChannel();
    const summary = await tick(MORNING, channel);

    expect(sent).toEqual([
      {
        text: "Buen día. Hoy: 1 hábito, 1 tarea y 1 pago (Netflix · S/ 50.00).",
        dedupeKey: "briefing:2026-10-08",
      },
    ]);
    expect(summary).toMatchObject({ status: "ok", sent: 1, failed: 0 });
    expect(await deliveries()).toMatchObject([
      { kind: "briefing", dedupeKey: "briefing:2026-10-08", status: "sent", channel: "telegram" },
    ]);
  });

  test("two ticks at the same time send ONE briefing; positive control: another day sends another", async () => {
    await busyDay();
    const { channel, sent } = recordingChannel(150);
    const [first, second] = await Promise.all([tick(MORNING, channel), tick(MORNING, channel)]);
    expect(sent.filter((message) => message.dedupeKey === "briefing:2026-10-08")).toHaveLength(1);
    expect(first.sent + second.sent).toBe(1);

    // Control: tomorrow's briefing is a different reminder and does go out.
    await task({ title: "mañana", dueDate: "2026-10-09" });
    await tick(limaInstant("2026-10-09", "07:35"), channel);
    expect(sent.map((message) => message.dedupeKey)).toEqual([
      "briefing:2026-10-08",
      "briefing:2026-10-09",
    ]);
  });

  test("a rerun later in the window sends nothing more", async () => {
    await busyDay();
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    await tick(new Date(MORNING.getTime() + 15 * 60_000), channel);
    await tick(new Date(MORNING.getTime() + 30 * 60_000), channel);
    expect(sent).toHaveLength(1);
  });

  test("an empty day sends nothing and is recorded as skipped (empty)", async () => {
    const { channel, sent } = recordingChannel();
    const summary = await tick(MORNING, channel);
    expect(sent).toEqual([]);
    expect(summary).toMatchObject({ sent: 0, skipped: 1 });
    expect(await deliveries()).toMatchObject([
      { kind: "briefing", status: "skipped", errorCode: "empty" },
    ]);
  });

  test("overdue tasks and tasks of other days are not counted; done or paused habits neither", async () => {
    await task({ title: "vieja", dueDate: "2026-10-01" });
    await task({ title: "mañana", dueDate: "2026-10-09" });
    const done = await habit({ name: "Meditar" });
    const paused = await habit({ name: "Yoga" });
    await testDb
      .insert(habitLogs)
      .values({ habitId: done, day: "2026-10-08", quantity: 1, target: 1 });
    await testDb
      .insert(habitPauses)
      .values({ habitId: paused, startDate: "2026-10-07", endDate: "2026-10-09" });
    await task({ title: "hoy", dueDate: "2026-10-08" });

    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent.map((message) => message.text)).toEqual(["Buen día. Hoy: 1 tarea."]);
  });

  test("with «Montos en Telegram» off the text carries no amount", async () => {
    await busyDay();
    await setSettings({ showAmountsTelegram: false });
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent.map((message) => message.text)).toEqual([
      "Buen día. Hoy: 1 hábito, 1 tarea y 1 pago (Netflix).",
    ]);
  });

  test("with the briefing switched off nothing is sent (the evening review still is)", async () => {
    await busyDay();
    await setSettings({ briefingEnabled: false });
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent).toEqual([]);
    await tick(EVENING, channel);
    expect(sent.map((message) => message.dedupeKey)).toEqual(["evening:2026-10-08"]);
  });

  test("moving the briefing time moves today's reminder while it has not gone out", async () => {
    await busyDay();
    const { channel, sent } = recordingChannel();
    await setSettings({ briefingTime: "08:30:00" });
    // 07:35 is before the new time: nothing yet.
    await tick(MORNING, channel);
    expect(sent).toEqual([]);
    // 08:35 is inside the new window.
    await tick(limaInstant("2026-10-08", "08:35"), channel);
    expect(sent.map((message) => message.dedupeKey)).toEqual(["briefing:2026-10-08"]);
  });

  test("a briefing whose window passed is skipped, never sent late", async () => {
    await busyDay();
    const { channel, sent } = recordingChannel();
    await tick(limaInstant("2026-10-08", "14:00"), channel);
    expect(sent).toEqual([]);
    expect(await deliveries()).toMatchObject([{ status: "skipped", errorCode: "window_expired" }]);
  });
});

describe("the payment reminders through the engine", () => {
  test("the eve goes out the day before, at the briefing's time, once", async () => {
    await recurring({ name: "Netflix", dayOfMonth: 9 });
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    await tick(new Date(MORNING.getTime() + 15 * 60_000), channel);

    expect(sent.map((message) => message.text)).toEqual(["Mañana vence Netflix · S/ 50.00."]);
    // The briefing of that day had nothing to say (the payment is not due today).
    const rows = await deliveries();
    expect(rows.map((row) => [row.dedupeKey.split(":")[0], row.status])).toEqual([
      ["briefing", "skipped"],
      ["payment_eve", "sent"],
    ]);
  });

  test("with the amounts switch off the eve names the payment without its amount", async () => {
    await recurring({ name: "Netflix", dayOfMonth: 9 });
    await setSettings({ showAmountsTelegram: false });
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent.map((message) => message.text)).toEqual(["Mañana vence Netflix."]);
  });

  test("a paid or skipped payment sends no eve (control: the pending one does)", async () => {
    const pending = await recurring({ name: "Pendiente", dayOfMonth: 9 });
    const paid = await recurring({ name: "Pagado", dayOfMonth: 9 });
    const skipped = await recurring({ name: "Omitido", dayOfMonth: 9 });
    await settle(paid.id, "2026-10-09", "paid");
    await settle(skipped.id, "2026-10-09", "skipped");
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent.map((message) => message.dedupeKey)).toEqual([
      `payment_eve:${pending.id}:2026-10-09`,
    ]);
  });

  test("the follow-up goes out 3 days later if it is still pending, and only that once", async () => {
    const netflix = await recurring({ name: "Netflix", dayOfMonth: 5 }); // a Monday
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    await tick(new Date(MORNING.getTime() + 15 * 60_000), channel);
    expect(sent.map((message) => message.text)).toEqual([
      "Netflix sigue pendiente desde el lun 5 oct.",
    ]);
    expect(sent[0].dedupeKey).toBe(`payment_followup:${netflix.id}:2026-10-05`);

    // The next days: no second one.
    await tick(limaInstant("2026-10-09", "07:35"), channel);
    await tick(limaInstant("2026-10-12", "07:35"), channel);
    expect(sent).toHaveLength(1);
  });

  test("once paid, the follow-up does not go out (control: pending, it does)", async () => {
    const paid = await recurring({ name: "Pagado", dayOfMonth: 5 });
    await settle(paid.id, "2026-10-05", "paid");
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent).toEqual([]);
  });

  test("with payment reminders switched off neither the eve nor the follow-up goes out", async () => {
    await recurring({ name: "Eve", dayOfMonth: 9 });
    await recurring({ name: "Follow", dayOfMonth: 5 });
    await setSettings({ paymentsEnabled: false });
    const { channel, sent } = recordingChannel();
    await tick(MORNING, channel);
    expect(sent).toEqual([]);
    const kinds = (await deliveries()).map((row) => row.kind);
    expect(kinds).not.toContain("payment_eve");
    expect(kinds).not.toContain("payment_followup");
  });
});

describe("the evening review through the engine", () => {
  test("goes out at the evening time only if a habit of today is left", async () => {
    const leer = await habit({ name: "Leer" });
    const { channel, sent } = recordingChannel();
    await tick(EVENING, channel);
    expect(sent.map((message) => message.text)).toEqual([
      "Te queda Leer. Si lo haces ahora, cuenta hoy.",
    ]);
    expect(sent[0].dedupeKey).toBe("evening:2026-10-08");

    // Control on another day, with the habit done: nothing is said.
    await testDb
      .insert(habitLogs)
      .values({ habitId: leer, day: "2026-10-09", quantity: 1, target: 1 });
    await tick(limaInstant("2026-10-09", "21:05"), channel);
    expect(sent).toHaveLength(1);
    expect(
      await testDb
        .select()
        .from(reminderDeliveries)
        .where(
          and(
            eq(reminderDeliveries.dedupeKey, "evening:2026-10-09"),
            eq(reminderDeliveries.status, "skipped"),
          ),
        ),
    ).toHaveLength(1);
  });

  test("follows the owner's evening time and its switch", async () => {
    await habit({ name: "Leer" });
    const { channel, sent } = recordingChannel();
    await setSettings({ eveningTime: "22:00:00" });
    await tick(EVENING, channel); // 21:05: before the new time
    expect(sent).toEqual([]);
    await setSettings({ eveningEnabled: false });
    await tick(limaInstant("2026-10-08", "22:05"), channel);
    expect(sent).toEqual([]);
  });

  test("a review at 23:30 is still sent at 00:30 and is about the day that ended", async () => {
    await setSettings({ eveningTime: "23:30:00", briefingEnabled: false });
    await habit({ name: "Leer" });
    const { channel, sent } = recordingChannel();
    await tick(limaInstant("2026-10-09", "00:30"), channel);
    expect(sent.map((message) => [message.dedupeKey, message.text])).toEqual([
      ["evening:2026-10-08", "Te queda Leer. Si lo haces ahora, cuenta hoy."],
    ]);
  });
});
