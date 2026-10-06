// F2 pure parts: the "Pago recurrente" and "Pagado…" schemas, the cycle and due-date copy, the
// "Pagos" view (pending, this month, all, archived) and "Pendiente de pagar" (getPendingForMonth).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPENSE_ERRORS } from "@/modules/finance/finance-copy";
import {
  cycleSummary,
  dueState,
  isUrgent,
  longDay,
  shortDay,
} from "@/modules/finance/payments-copy";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import {
  buildPaymentsView,
  pendingForMonth,
  settlementRange,
} from "@/modules/finance/payments-view";
import {
  createRecurringInputSchema,
  payInputSchema,
  periodInputSchema,
  updateRecurringInputSchema,
  type RecurringItem,
  type SettlementItem,
} from "@/modules/finance/recurring-input";

const ID = "44444444-4444-4444-8444-444444444444";

const valid = {
  name: "  Internet   casa ",
  variable: false,
  amount: "99,90",
  currency: "PEN",
  categoryId: "",
  paymentMethodId: null,
  cycle: "monthly",
  weekday: 3,
  dayOfMonth: 15,
  intervalMonths: 3,
  anchorMonth: 4,
  startDate: "2026-10-05",
  notes: "  Contrato anual\n  ",
};

function errorsOf(input: unknown, schema = createRecurringInputSchema) {
  const parsed = schema.safeParse(input);
  if (parsed.success) return {};
  return Object.fromEntries(
    parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("the recurring payment schema", () => {
  test("monthly: normalized name, cents, only its own fields, notes trimmed", () => {
    expect(createRecurringInputSchema.parse(valid)).toEqual({
      name: "Internet casa",
      amountCents: 9990,
      currency: "PEN",
      categoryId: null,
      paymentMethodId: null,
      cycle: "monthly",
      weekday: null,
      dayOfMonth: 15,
      intervalMonths: null,
      anchorMonth: null,
      startDate: "2026-10-05",
      notes: "Contrato anual",
    });
  });

  test.each([
    ["weekly", { weekday: 3, dayOfMonth: null, intervalMonths: null, anchorMonth: null }],
    ["every_n_months", { weekday: null, dayOfMonth: 15, intervalMonths: 3, anchorMonth: 4 }],
    ["yearly", { weekday: null, dayOfMonth: 15, intervalMonths: null, anchorMonth: 4 }],
  ])("%s keeps exactly its fields", (cycle, fields) => {
    expect(createRecurringInputSchema.parse({ ...valid, cycle })).toMatchObject({
      cycle,
      ...fields,
    });
  });

  test("variable: no amount, whatever was typed", () => {
    expect(
      createRecurringInputSchema.parse({ ...valid, variable: true, amount: "abc" }),
    ).toMatchObject({
      amountCents: null,
    });
  });

  test.each<[string, Record<string, unknown>, Record<string, string>]>([
    ["no name", { name: "  " }, { name: RECURRING_ERRORS.nameRequired }],
    ["a name too long", { name: "x".repeat(81) }, { name: RECURRING_ERRORS.nameTooLong }],
    ["no amount and not variable", { amount: "" }, { amount: RECURRING_ERRORS.amountRequired }],
    ["an amount with 3 decimals", { amount: "1.234" }, { amount: EXPENSE_ERRORS.amount.decimals }],
    [
      "weekly without a weekday",
      { cycle: "weekly", weekday: 8 },
      { weekday: RECURRING_ERRORS.weekday },
    ],
    ["monthly on day 32", { dayOfMonth: 32 }, { dayOfMonth: RECURRING_ERRORS.dayOfMonth }],
    [
      "every 1 month",
      { cycle: "every_n_months", intervalMonths: 1 },
      { intervalMonths: RECURRING_ERRORS.intervalMonths },
    ],
    [
      "every 13 months",
      { cycle: "every_n_months", intervalMonths: 13 },
      { intervalMonths: RECURRING_ERRORS.intervalMonths },
    ],
    [
      "yearly in month 13",
      { cycle: "yearly", anchorMonth: 13 },
      { anchorMonth: RECURRING_ERRORS.anchorMonth },
    ],
    [
      "yearly without a month",
      { cycle: "yearly", anchorMonth: null },
      { anchorMonth: RECURRING_ERRORS.anchorMonth },
    ],
    ["an unknown cycle", { cycle: "daily" }, { cycle: RECURRING_ERRORS.cycle }],
    [
      "a start that isn't a day",
      { startDate: "2026-02-30" },
      { startDate: RECURRING_ERRORS.startInvalid },
    ],
    [
      "a start before 2000",
      { startDate: "1999-12-31" },
      { startDate: RECURRING_ERRORS.startOutOfRange },
    ],
    ["notes too long", { notes: "x".repeat(501) }, { notes: RECURRING_ERRORS.notesTooLong }],
    [
      "notes with a control character",
      { notes: "a\u0000b" },
      { notes: RECURRING_ERRORS.notesInvisible },
    ],
    ["a bad category id", { categoryId: "x" }, { categoryId: EXPENSE_ERRORS.categoryUnavailable }],
  ])("%s is refused on its field", (_, change, expected) => {
    expect(errorsOf({ ...valid, ...change })).toMatchObject(expected);
  });

  test("notes keep their line breaks; empty notes are none", () => {
    expect(createRecurringInputSchema.parse({ ...valid, notes: "a\nb" }).notes).toBe("a\nb");
    expect(createRecurringInputSchema.parse({ ...valid, notes: "   " }).notes).toBeNull();
    expect(createRecurringInputSchema.parse({ ...valid, notes: null }).notes).toBeNull();
  });

  test("edit needs an id", () => {
    expect(updateRecurringInputSchema.parse({ ...valid, id: ID }).id).toBe(ID);
    expect(errorsOf(valid, updateRecurringInputSchema)).toMatchObject({
      id: RECURRING_ERRORS.notFound,
    });
  });
});

describe("Lima's midnight for the date of a pay", () => {
  afterEach(() => vi.useRealTimers());

  test("at 04:30 UTC it is still the 5th in Lima: the 6th is in the future", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T04:30:00Z"));
    expect(
      errorsOf({ id: ID, dueOn: "2026-10-05", spentOn: "2026-10-06" }, payInputSchema as never),
    ).toMatchObject({ spentOn: EXPENSE_ERRORS.dateFuture });
    vi.setSystemTime(new Date("2026-10-06T05:30:00Z"));
    expect(
      payInputSchema.safeParse({ id: ID, dueOn: "2026-10-05", spentOn: "2026-10-06" }).success,
    ).toBe(true);
  });
});

describe("the pay and period schemas", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("one tap: only the period", () => {
    expect(payInputSchema.parse({ id: ID, dueOn: "2026-10-05" })).toEqual({
      id: ID,
      dueOn: "2026-10-05",
    });
  });

  test("Pagado…: amount in cents, a past date, a method or none", () => {
    expect(
      payInputSchema.parse({
        id: ID,
        dueOn: "2026-10-05",
        amount: "1080",
        spentOn: "2026-10-04",
        paymentMethodId: "",
      }),
    ).toEqual({
      id: ID,
      dueOn: "2026-10-05",
      amount: 108_000,
      spentOn: "2026-10-04",
      paymentMethodId: null,
    });
    expect(
      errorsOf({ id: ID, dueOn: "2026-10-05", amount: "0" }, payInputSchema as never),
    ).toMatchObject({
      amount: EXPENSE_ERRORS.amount.tooSmall,
    });
    expect(
      errorsOf({ id: ID, dueOn: "2026-10-05", spentOn: "2026-10-06" }, payInputSchema as never),
    ).toMatchObject({
      spentOn: EXPENSE_ERRORS.dateFuture,
    });
    expect(periodInputSchema.safeParse({ id: ID, dueOn: "2026-13-01" }).success).toBe(false);
  });
});

describe("copy", () => {
  test.each<[Parameters<typeof cycleSummary>[0], string]>([
    [
      { cycle: "weekly", weekday: 1, dayOfMonth: null, intervalMonths: null, anchorMonth: null },
      "Semanal, lunes",
    ],
    [
      { cycle: "monthly", weekday: null, dayOfMonth: 15, intervalMonths: null, anchorMonth: null },
      "Mensual, día 15",
    ],
    [
      { cycle: "yearly", weekday: null, dayOfMonth: 23, intervalMonths: null, anchorMonth: 3 },
      "Anual, 23 mar",
    ],
    [
      { cycle: "every_n_months", weekday: null, dayOfMonth: 5, intervalMonths: 3, anchorMonth: 1 },
      "Cada 3 meses, día 5",
    ],
  ])("cycle %#", (schedule, expected) => {
    expect(cycleSummary(schedule)).toBe(expected);
  });

  test.each([
    ["2026-10-02", "Venció hace 3 días", "Venció hace 3 días", "overdue", true],
    ["2026-10-04", "Venció ayer", "Venció ayer", "overdue", true],
    ["2026-10-05", "Vence hoy", "Vence hoy", "today", true],
    ["2026-10-06", "Vence mañana", "Vence mañana", "soon", false],
    ["2026-10-08", "Vence el jue 8", "Vence el jueves 8", "soon", false],
    ["2026-10-12", "Vence el lun 12", "Vence el lunes 12", "soon", false],
    ["2027-03-23", "Vence el 23 mar", "Vence el 23 de marzo", "later", false],
  ])("due %s: %s", (due, label, spoken, kind, urgent) => {
    const state = dueState(due, "2026-10-05");
    expect(state).toMatchObject({ label, spoken, kind });
    expect(isUrgent(state)).toBe(urgent);
  });

  test("days", () => {
    expect(shortDay("2026-10-09")).toBe("vie 9 oct");
    expect(longDay("2026-09-01")).toBe("Martes 1 de setiembre de 2026");
  });
});

// ── The view ─────────────────────────────────────────────────────────────────────────────────

let serial = 0;
function item(values: Partial<RecurringItem>): RecurringItem {
  serial += 1;
  return {
    id: `55555555-5555-4555-8555-${String(serial).padStart(12, "0")}`,
    name: `Pago ${serial}`,
    amountCents: 5000,
    currency: "PEN",
    category: null,
    paymentMethod: null,
    cycle: "monthly",
    weekday: null,
    dayOfMonth: 5,
    intervalMonths: null,
    anchorMonth: null,
    startDate: "2026-01-01",
    notes: null,
    archived: false,
    ...values,
  };
}

const paid = (recurring: RecurringItem, dueOn: string, amountCents = 5000): SettlementItem => ({
  recurringId: recurring.id,
  dueOn,
  status: "paid",
  expense: { id: `e-${dueOn}`, amountCents, currency: "PEN", exchangeRateE4: null, spentOn: dueOn },
});
const skipped = (recurring: RecurringItem, dueOn: string): SettlementItem => ({
  recurringId: recurring.id,
  dueOn,
  status: "skipped",
  expense: null,
});

describe("buildPaymentsView", () => {
  const today = "2026-10-05";

  test("pending (oldest first), this month with statuses, all by next due, archived apart", () => {
    const internet = item({ name: "Internet", dayOfMonth: 5 });
    const luz = item({ name: "Luz", dayOfMonth: 20, amountCents: null });
    const seguro = item({ name: "Seguro", cycle: "yearly", dayOfMonth: 23, anchorMonth: 3 });
    const gym = item({ name: "Gimnasio", cycle: "weekly", weekday: 3, dayOfMonth: null });
    const viejo = item({ name: "Viejo", archived: true });
    const view = buildPaymentsView(
      [internet, luz, seguro, gym, viejo],
      [paid(internet, "2026-09-05"), skipped(gym, "2026-10-07")],
      today,
    );
    expect(view.pending.map((p) => `${p.recurring.name} ${p.dueOn}`)).toEqual(
      expect.arrayContaining(["Internet 2026-10-05", "Luz 2026-08-20", "Luz 2026-09-20"]),
    );
    expect(view.pending.map((p) => p.dueOn)).toEqual([...view.pending.map((p) => p.dueOn)].sort());
    // Internet's September is paid, the gym's Oct 7 skipped: both out of pending.
    expect(
      view.pending.some((p) => p.recurring.name === "Internet" && p.dueOn === "2026-09-05"),
    ).toBe(false);
    expect(view.pending.some((p) => p.dueOn === "2026-10-07")).toBe(false);
    expect(view.pending.some((p) => p.recurring.archived)).toBe(false);

    const month = view.thisMonth.map((e) => `${e.recurring.name} ${e.dueOn ?? "-"} ${e.status}`);
    expect(month).toContain("Internet 2026-10-05 pending");
    expect(month).toContain("Luz 2026-10-20 pending");
    expect(month).toContain("Gimnasio 2026-10-07 skipped");
    expect(month.at(-1)).toBe("Seguro - none");
    expect(month.some((line) => line.startsWith("Viejo"))).toBe(false);

    expect(view.active.map((e) => `${e.recurring.name} ${e.nextDue}`)).toEqual([
      "Internet 2026-10-05",
      // The 7th was skipped: the next one left is the 14th.
      "Gimnasio 2026-10-14",
      "Luz 2026-10-20",
      "Seguro 2027-03-23",
    ]);
    expect(view.archived.map((a) => a.name)).toEqual(["Viejo"]);
  });

  test("the next due date skips periods already paid or skipped (paid ahead of time)", () => {
    const internet = item({ name: "Internet", dayOfMonth: 8 });
    const seguro = item({ name: "Seguro", cycle: "yearly", dayOfMonth: 9, anchorMonth: 10 });
    const view = buildPaymentsView(
      [internet, seguro],
      [paid(internet, "2026-10-08"), skipped(seguro, "2026-10-09")],
      today,
    );
    expect(view.active.map((entry) => `${entry.recurring.name} ${entry.nextDue}`)).toEqual([
      "Internet 2026-11-08",
      "Seguro 2027-10-09",
    ]);
  });

  test("a paid period of this month shows its real amount", () => {
    const internet = item({ dayOfMonth: 2 });
    const view = buildPaymentsView([internet], [paid(internet, "2026-10-02", 7777)], today);
    expect(view.thisMonth[0]).toMatchObject({ status: "paid", expense: { amountCents: 7777 } });
  });

  test("the settlements it needs: the pending window and the whole month", () => {
    expect(settlementRange(today)).toEqual({ from: "2026-08-06", to: "2026-10-31" });
    expect(settlementRange("2026-10-28")).toEqual({ from: "2026-08-29", to: "2026-11-04" });
  });
});

describe("pendingForMonth (F3's Pendiente de pagar)", () => {
  test("pending periods of the month: PEN, USD converted, USD without a rate, variable", () => {
    const pen = item({ dayOfMonth: 20, amountCents: 10_000 });
    const usd = item({ dayOfMonth: 25, amountCents: 1000, currency: "USD" });
    const variable = item({ dayOfMonth: 28, amountCents: null });
    const done = item({ dayOfMonth: 2, amountCents: 99_999 });
    const archived = item({ dayOfMonth: 21, archived: true });
    const items = [pen, usd, variable, done, archived];
    const settlements = [paid(done, "2026-10-02")];
    expect(pendingForMonth(items, settlements, "2026-10", "2026-10-05", 37_500)).toEqual({
      count: 3,
      totalPenCents: 10_000 + 3750,
      unconvertedUsdCents: 0,
      variableCount: 1,
    });
    expect(pendingForMonth(items, settlements, "2026-10", "2026-10-05", null)).toEqual({
      count: 3,
      totalPenCents: 10_000,
      unconvertedUsdCents: 1000,
      variableCount: 1,
    });
  });

  test("months beyond the 60-day window count nothing; weekly counts every week", () => {
    const weeklyItem = item({ cycle: "weekly", weekday: 1, dayOfMonth: null, amountCents: 100 });
    expect(pendingForMonth([weeklyItem], [], "2026-07", "2026-10-05", null).count).toBe(0);
    // August: from Aug 6 (60 days back) on, Mondays 10, 17, 24, 31.
    expect(pendingForMonth([weeklyItem], [], "2026-08", "2026-10-05", null)).toMatchObject({
      count: 4,
      totalPenCents: 400,
    });
  });
});
