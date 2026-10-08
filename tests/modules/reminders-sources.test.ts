// reminders (R2) → the sources of `finance`, `habits` and `tasks` and the briefing source, with a
// fixed clock and the modules' reads replaced by plain data. The queries themselves (paid, skipped
// and archived payments, paused habits…) are checked against Postgres in
// tests/integration/reminders-sources.test.ts; here: the slots, the windows, the dedupe keys, the
// text and the midnight crossing.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UpcomingPayment } from "@/modules/finance/contracts";
import { formatMoney } from "@/modules/finance/money";
import { financeReminderSource } from "@/modules/finance/reminders-source";
import { habitsReminderSource } from "@/modules/habits/reminders-source";
import { tasksReminderSource } from "@/modules/tasks/reminders-source";
import { collectBriefingFacts, createBriefingSource } from "@/modules/reminders/briefing-source";
import type {
  ReminderCandidate,
  ReminderContext,
  ReminderKind,
  ReminderSource,
} from "@/modules/reminders/contracts";
import { addDaysToKey, limaDayOf, limaInstant, windowState } from "@/modules/reminders/slots";

const state = vi.hoisted(() => ({
  payments: [] as UpcomingPayment[],
  paymentCalls: [] as [string, string, string][],
  habits: [] as {
    name: string;
    kind: "build" | "avoid";
    done: boolean;
    day?: string;
  }[],
  habitDays: [] as string[],
  tasks: [] as { due: { kind: "overdue" | "today" } }[],
  taskDays: [] as string[],
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/finance/contracts", () => ({
  selectUpcomingPayments: async (_db: unknown, from: string, to: string, today: string) => {
    state.paymentCalls.push([from, to, today]);
    return state.payments.filter((payment) => payment.dueOn >= from && payment.dueOn <= to);
  },
}));
vi.mock("@/modules/habits/contracts", () => ({
  selectHabitsTodaySummary: async (_db: unknown, at: Date) => {
    const day = limaDayOf(at);
    state.habitDays.push(day);
    // `day` set: the habit exists only that day (to tell today's read from yesterday's).
    return state.habits.filter((habit) => habit.day === undefined || habit.day === day);
  },
}));
vi.mock("@/modules/tasks/contracts", () => ({
  selectTasksTodaySummary: async (_db: unknown, at: Date) => {
    state.taskDays.push(limaDayOf(at));
    return state.tasks;
  },
}));

const FIFTY = formatMoney(5_000, "PEN");

/** The engine's context for an instant in Lima. */
function context(
  day: string,
  time: string,
  times: { briefing: string; evening: string } = { briefing: "07:30", evening: "21:00" },
  off: ReminderKind[] = [],
): ReminderContext {
  const now = limaInstant(day, time);
  return {
    now,
    today: limaDayOf(now),
    yesterday: addDaysToKey(limaDayOf(now), -1),
    times,
    enabled: {
      briefing: true,
      payment_eve: true,
      payment_followup: true,
      evening_review: true,
      habit_time: true,
      ...Object.fromEntries(off.map((kind) => [kind, false])),
    },
  };
}

function payment(overrides: Partial<UpcomingPayment> = {}): UpcomingPayment {
  return {
    recurringId: "pay-1",
    name: "Netflix",
    dueOn: "2026-10-09",
    amountCents: 5_000,
    currency: "PEN",
    ...overrides,
  };
}

const keys = (candidates: readonly ReminderCandidate[]) =>
  candidates.map((candidate) => candidate.dedupeKey);
const build = (candidate: ReminderCandidate, showAmounts = true) =>
  candidate.build({ channel: "telegram", showAmounts });

beforeEach(() => {
  state.payments = [];
  state.paymentCalls = [];
  state.habits = [];
  state.habitDays = [];
  state.tasks = [];
  state.taskDays = [];
});

describe("finance: the eve of a payment", () => {
  test("the day before it is due, at the briefing's time, with the story's text", async () => {
    state.payments = [payment({ dueOn: "2026-10-09" })];
    const candidates = await financeReminderSource.candidates(context("2026-10-08", "07:35"));

    expect(candidates).toHaveLength(1);
    const [eve] = candidates;
    expect(eve.kind).toBe("payment_eve");
    expect(eve.dedupeKey).toBe("payment_eve:pay-1:2026-10-09");
    expect(eve.dueAt).toEqual(limaInstant("2026-10-08", "07:30"));
    expect(await build(eve, true)).toBe(`Mañana vence Netflix · ${FIFTY}.`);
  });

  test("with the amounts switch off the text has no amount", async () => {
    state.payments = [payment()];
    const [eve] = await financeReminderSource.candidates(context("2026-10-08", "07:35"));
    const text = await build(eve, false);
    expect(text).toBe("Mañana vence Netflix.");
    expect(text).not.toContain("S/");
  });

  test("it follows the owner's briefing time (the reminder moves with it)", async () => {
    state.payments = [payment()];
    const [eve] = await financeReminderSource.candidates(
      context("2026-10-08", "08:05", { briefing: "08:00", evening: "21:00" }),
    );
    expect(eve.dueAt).toEqual(limaInstant("2026-10-08", "08:00"));
  });

  test("asks finance ONCE, for a range that covers both windows, anchored on today", async () => {
    await financeReminderSource.candidates(context("2026-10-08", "07:35"));
    expect(state.paymentCalls).toEqual([["2026-10-04", "2026-10-09", "2026-10-08"]]);
  });

  test("asks nothing while both payment reminders are off (control: with one on it asks)", async () => {
    state.payments = [payment()];
    const off = await financeReminderSource.candidates(
      context("2026-10-08", "07:35", undefined, ["payment_eve", "payment_followup"]),
    );
    expect(off).toEqual([]);
    expect(state.paymentCalls).toEqual([]);

    const eveOnly = await financeReminderSource.candidates(
      context("2026-10-08", "07:35", undefined, ["payment_followup"]),
    );
    expect(keys(eveOnly)).toEqual(["payment_eve:pay-1:2026-10-09"]);
    expect(state.paymentCalls).toHaveLength(1);
  });

  test("the one read is split in memory: an eve and a follow-up come out of the same answer", async () => {
    state.payments = [
      payment({ recurringId: "eve", dueOn: "2026-10-09" }),
      payment({ recurringId: "follow", dueOn: "2026-10-05" }),
      payment({ recurringId: "between", dueOn: "2026-10-06" }),
    ];
    const candidates = await financeReminderSource.candidates(context("2026-10-08", "07:35"));
    expect(keys(candidates).sort()).toEqual([
      "payment_eve:eve:2026-10-09",
      "payment_followup:follow:2026-10-05",
    ]);
    expect(state.paymentCalls).toHaveLength(1);
  });

  test("a payment that is not due tomorrow does not remind (control: tomorrow's does)", async () => {
    state.payments = [
      payment({ recurringId: "later", dueOn: "2026-10-12" }),
      payment({ recurringId: "tomorrow", dueOn: "2026-10-09" }),
    ];
    const candidates = await financeReminderSource.candidates(context("2026-10-08", "07:35"));
    expect(keys(candidates)).toEqual(["payment_eve:tomorrow:2026-10-09"]);
  });

  test("a payment due today whose eve window already closed gets no candidate at all", async () => {
    state.payments = [payment({ dueOn: "2026-10-08" })];
    // The eve was yesterday 07:30: closed (a payment created this morning for today).
    expect(await financeReminderSource.candidates(context("2026-10-08", "10:00"))).toEqual([]);
  });

  test("one candidate per payment and due date", async () => {
    state.payments = [
      payment({ recurringId: "a", dueOn: "2026-10-09" }),
      payment({ recurringId: "b", dueOn: "2026-10-09" }),
    ];
    const candidates = await financeReminderSource.candidates(context("2026-10-08", "07:35"));
    expect(keys(candidates)).toEqual(["payment_eve:a:2026-10-09", "payment_eve:b:2026-10-09"]);
  });

  test("an eve window that crosses midnight is still offered, and says «Hoy»", async () => {
    // Briefing at 23:00: the eve of a payment due the 9th opens the 8th at 23:00 and is open at 00:30.
    state.payments = [payment({ dueOn: "2026-10-09" })];
    const [eve] = await financeReminderSource.candidates(
      context("2026-10-09", "00:30", { briefing: "23:00", evening: "21:00" }),
    );
    expect(eve.dedupeKey).toBe("payment_eve:pay-1:2026-10-09");
    expect(eve.dueAt).toEqual(limaInstant("2026-10-08", "23:00"));
    expect(await build(eve, false)).toBe("Hoy vence Netflix.");
  });
});

describe("finance: the single follow-up", () => {
  test("3 days after it was due, at the briefing's time, still pending: «sigue pendiente desde…»", async () => {
    state.payments = [payment({ dueOn: "2026-10-05" })]; // a Monday
    const candidates = await financeReminderSource.candidates(context("2026-10-08", "07:35"));

    expect(candidates).toHaveLength(1);
    const [followup] = candidates;
    expect(followup.kind).toBe("payment_followup");
    expect(followup.dedupeKey).toBe("payment_followup:pay-1:2026-10-05");
    expect(followup.dueAt).toEqual(limaInstant("2026-10-08", "07:30"));
    expect(await build(followup, true)).toBe("Netflix sigue pendiente desde el lun 5 oct.");
  });

  test("before the third day there is no follow-up (control: on it there is)", async () => {
    state.payments = [payment({ dueOn: "2026-10-06" })];
    expect(await financeReminderSource.candidates(context("2026-10-08", "07:35"))).toEqual([]);
    expect(keys(await financeReminderSource.candidates(context("2026-10-09", "07:35")))).toEqual([
      "payment_followup:pay-1:2026-10-06",
    ]);
  });

  test("never again: once its 2-hour window has passed the payment gives no candidate", async () => {
    state.payments = [payment({ dueOn: "2026-10-05" })];
    // The exact edge of the window [07:30, 09:30): 09:29 is in, 09:30 is out.
    expect(keys(await financeReminderSource.candidates(context("2026-10-08", "09:29")))).toEqual([
      "payment_followup:pay-1:2026-10-05",
    ]);
    expect(await financeReminderSource.candidates(context("2026-10-08", "09:30"))).toEqual([]);
    expect(await financeReminderSource.candidates(context("2026-10-09", "07:35"))).toEqual([]);
    expect(await financeReminderSource.candidates(context("2026-10-12", "07:35"))).toEqual([]);
  });

  test("a follow-up of a payment due 4 days ago, with a late briefing time, crosses midnight", async () => {
    state.payments = [payment({ dueOn: "2026-10-05" })];
    // Briefing 23:00: the follow-up is the 8th at 23:00, open at 00:30 of the 9th.
    const candidates = await financeReminderSource.candidates(
      context("2026-10-09", "00:30", { briefing: "23:00", evening: "21:00" }),
    );
    expect(keys(candidates)).toEqual(["payment_followup:pay-1:2026-10-05"]);
  });
});

describe("finance: the briefing's facts", () => {
  test("the payments due that day, with their amount formatted (the briefing decides to show it)", async () => {
    state.payments = [
      payment({ recurringId: "a", name: "Netflix", dueOn: "2026-10-08" }),
      payment({ recurringId: "b", name: "Agua", dueOn: "2026-10-08", amountCents: null }),
      payment({ recurringId: "c", name: "Luz", dueOn: "2026-10-09" }),
    ];
    const facts = await financeReminderSource.briefingFacts!(limaInstant("2026-10-08", "07:35"));
    expect(facts.paymentsDueToday).toEqual([
      { name: "Netflix", amountLabel: FIFTY },
      { name: "Agua", amountLabel: null },
    ]);
    expect(state.paymentCalls).toEqual([["2026-10-08", "2026-10-08", "2026-10-08"]]);
  });
});

describe("habits: the evening review", () => {
  const evening = (...names: string[]) =>
    (state.habits = names.map((name) => ({ name, kind: "build" as const, done: false })));

  test("at the evening time, naming what is left, with the story's sentence", async () => {
    evening("Leer");
    const candidates = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(candidates).toHaveLength(1);
    const [review] = candidates;
    expect(review.kind).toBe("evening_review");
    expect(review.dedupeKey).toBe("evening:2026-10-08");
    expect(review.dueAt).toEqual(limaInstant("2026-10-08", "21:00"));
    expect(await build(review)).toBe("Te queda Leer. Si lo haces ahora, cuenta hoy.");
  });

  test("several habits left: one natural sentence", async () => {
    evening("Leer", "Meditar");
    const [review] = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(await build(review)).toBe("Te quedan Leer y Meditar. Si los haces ahora, cuentan hoy.");
  });

  test("a habit that is done does not count; with everything done there is nothing to say", async () => {
    state.habits = [
      { name: "Leer", kind: "build", done: true },
      { name: "Meditar", kind: "build", done: false },
    ];
    const [review] = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(await build(review)).toBe("Te queda Meditar. Si lo haces ahora, cuenta hoy.");

    state.habits = [{ name: "Leer", kind: "build", done: true }];
    expect(await build(review)).toBeNull();
  });

  test("a habit «a evitar» is never left to do", async () => {
    state.habits = [{ name: "No fumar", kind: "avoid", done: false }];
    const [review] = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(await build(review)).toBeNull();
  });

  test("a day with no habits at all says nothing", async () => {
    const [review] = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(await build(review)).toBeNull();
  });

  test("follows the owner's evening time", async () => {
    const [review] = await habitsReminderSource.candidates(
      context("2026-10-08", "22:10", { briefing: "07:30", evening: "22:00" }),
    );
    expect(review.dueAt).toEqual(limaInstant("2026-10-08", "22:00"));
  });

  test("never offers yesterday's review: at 00:30 with the review at 23:30 only today's (not yet due) exists", async () => {
    evening("Leer");
    const times = { briefing: "07:30", evening: "23:30" };
    const after = await habitsReminderSource.candidates(context("2026-10-09", "00:30", times));
    expect(keys(after)).toEqual(["evening:2026-10-09"]);
    expect(windowState(after[0].dueAt, limaInstant("2026-10-09", "00:30"))).toBe("early");

    // Control: at 23:45 the same review is due and open.
    const before = await habitsReminderSource.candidates(context("2026-10-08", "23:45", times));
    expect(keys(before)).toEqual(["evening:2026-10-08"]);
    expect(windowState(before[0].dueAt, limaInstant("2026-10-08", "23:45"))).toBe("open");
    expect(await build(before[0])).toBe("Te queda Leer. Si lo haces ahora, cuenta hoy.");
  });

  test("the window's exact edges for the 21:00 review: 22:59 is open, 23:00 is closed", async () => {
    const [review] = await habitsReminderSource.candidates(context("2026-10-08", "21:05"));
    expect(windowState(review.dueAt, limaInstant("2026-10-08", "20:59"))).toBe("early");
    expect(windowState(review.dueAt, limaInstant("2026-10-08", "21:00"))).toBe("open");
    expect(windowState(review.dueAt, limaInstant("2026-10-08", "22:59"))).toBe("open");
    expect(windowState(review.dueAt, limaInstant("2026-10-08", "23:00"))).toBe("expired");
  });

  test("the briefing's fact is the number of habits left", async () => {
    state.habits = [
      { name: "Leer", kind: "build", done: false },
      { name: "Correr", kind: "build", done: true },
      { name: "No fumar", kind: "avoid", done: false },
      { name: "Yoga", kind: "build", done: false },
    ];
    expect(await habitsReminderSource.briefingFacts!(limaInstant("2026-10-08", "07:35"))).toEqual({
      habitsToday: 2,
    });
  });
});

describe("tasks: the briefing's facts", () => {
  test("counts the tasks due that day and never the overdue ones", async () => {
    state.tasks = [
      { due: { kind: "overdue" } },
      { due: { kind: "today" } },
      { due: { kind: "today" } },
      { due: { kind: "overdue" } },
    ];
    expect(await tasksReminderSource.briefingFacts!(limaInstant("2026-10-08", "07:35"))).toEqual({
      tasksDueToday: 2,
    });
    expect(state.taskDays).toEqual(["2026-10-08"]);
  });

  test("has no reminder of its own in v1", async () => {
    expect(await tasksReminderSource.candidates(context("2026-10-08", "07:35"))).toEqual([]);
  });
});

describe("the briefing source", () => {
  const fact = (
    id: string,
    facts: Awaited<ReturnType<NonNullable<ReminderSource["briefingFacts"]>>>,
  ) =>
    ({ id, candidates: async () => [], briefingFacts: async () => facts }) satisfies ReminderSource;

  test("one candidate for today at the briefing time, keyed by the day", async () => {
    const source = createBriefingSource(() => []);
    const candidates = await source.candidates(context("2026-10-08", "07:35"));
    expect(keys(candidates)).toEqual(["briefing:2026-10-08"]);
    expect(candidates[0].kind).toBe("briefing");
    expect(candidates[0].dueAt).toEqual(limaInstant("2026-10-08", "07:30"));
  });

  test("merges what every module knows into the story's one line", async () => {
    const source = createBriefingSource(() => [
      fact("habits", { habitsToday: 3 }),
      fact("tasks", { tasksDueToday: 2 }),
      fact("finance", { paymentsDueToday: [{ name: "Netflix", amountLabel: FIFTY }] }),
      { id: "no-facts", candidates: async () => [] },
    ]);
    const [briefing] = await source.candidates(context("2026-10-08", "07:35"));
    expect(await build(briefing, true)).toBe(
      `Buen día. Hoy: 3 hábitos, 2 tareas y 1 pago (Netflix · ${FIFTY}).`,
    );
  });

  test("the amounts switch decides whether the payment shows its amount", async () => {
    const source = createBriefingSource(() => [
      fact("finance", { paymentsDueToday: [{ name: "Netflix", amountLabel: FIFTY }] }),
    ]);
    const [briefing] = await source.candidates(context("2026-10-08", "07:35"));
    const text = await build(briefing, false);
    expect(text).toBe("Buen día. Hoy: 1 pago (Netflix).");
    expect(text).not.toContain("S/");
  });

  test("an empty day builds nothing (the engine records it as skipped)", async () => {
    const source = createBriefingSource(() => [
      fact("habits", { habitsToday: 0 }),
      fact("tasks", { tasksDueToday: 0 }),
      fact("finance", { paymentsDueToday: [] }),
    ]);
    const [briefing] = await source.candidates(context("2026-10-08", "07:35"));
    expect(await build(briefing)).toBeNull();
  });

  test("a module that fails makes the build fail (the engine retries it), never a half briefing", async () => {
    const source = createBriefingSource(() => [
      fact("habits", { habitsToday: 3 }),
      {
        id: "broken",
        candidates: async () => [],
        briefingFacts: async () => {
          throw new Error("boom");
        },
      },
    ]);
    const [briefing] = await source.candidates(context("2026-10-08", "07:35"));
    await expect(build(briefing)).rejects.toThrow("boom");
  });

  test("never offers yesterday's briefing: at 00:30 with the briefing at 23:30 only today's (not yet due) exists", async () => {
    const asked: string[] = [];
    const source = createBriefingSource(() => [
      {
        id: "spy",
        candidates: async () => [],
        briefingFacts: async (at) => {
          asked.push(limaDayOf(at));
          return { tasksDueToday: 1 };
        },
      },
    ]);
    const times = { briefing: "23:30", evening: "21:00" };
    const after = await source.candidates(context("2026-10-09", "00:30", times));
    expect(keys(after)).toEqual(["briefing:2026-10-09"]);
    expect(windowState(after[0].dueAt, limaInstant("2026-10-09", "00:30"))).toBe("early");

    // Control: at 23:45 the same briefing is due and open, and asks for that very day.
    const before = await source.candidates(context("2026-10-08", "23:45", times));
    expect(keys(before)).toEqual(["briefing:2026-10-08"]);
    expect(windowState(before[0].dueAt, limaInstant("2026-10-08", "23:45"))).toBe("open");
    await build(before[0]);
    expect(asked).toEqual(["2026-10-08"]);
  });

  test("collectBriefingFacts: a source that throws makes the whole collection throw", async () => {
    const broken: ReminderSource = {
      id: "broken",
      candidates: async () => [],
      briefingFacts: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      collectBriefingFacts(
        [fact("habits", { habitsToday: 3 }), broken],
        limaInstant("2026-10-08", "07:35"),
      ),
    ).rejects.toThrow("boom");
    // Control: without the broken one it merges.
    expect(
      await collectBriefingFacts(
        [fact("habits", { habitsToday: 3 }), fact("tasks", { tasksDueToday: 2 })],
        limaInstant("2026-10-08", "07:35"),
      ),
    ).toEqual({ habitsToday: 3, tasksDueToday: 2, paymentsDueToday: [] });
  });
});
