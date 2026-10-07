// Installments ("cuotas", polish → installments): the pure parts. `schedule.ts` stops at the Nth
// due date (case tables: short months, year change, a start in the middle of a month, N = 1, the
// 60-day window, settled periods), the installment number is the position of the due date, the
// "Pago recurrente" schema takes "Termina después de N pagos" for monthly payments only, and the
// copy and the home DTO say "Cuota 3 de 6".
import { describe, expect, test } from "vitest";
import {
  cycleSummary,
  installmentLabel,
  installmentsCount,
  RECURRING_ERRORS,
} from "@/modules/finance/payments-copy";
import { buildPaymentsView, isEnded } from "@/modules/finance/payments-view";
import {
  createRecurringInputSchema,
  updateRecurringInputSchema,
  type RecurringItem,
} from "@/modules/finance/recurring-input";
import {
  dueDatesBetween,
  installmentNumber,
  isDueDate,
  lastInstallmentDue,
  monthlyPosition,
  nextDueDate,
  nextDueDates,
  nextOpenDue,
  pendingPeriods,
  startFrom,
  type Schedule,
} from "@/modules/finance/schedule";
import { installmentOf, toFinanceTodayItems } from "@/modules/finance/today-summary";

const FOREVER = { from: "2000-01-01", to: "2100-12-31" };

const monthly = (dayOfMonth: number, startDate: string, installmentsTotal: number | null) =>
  ({
    cycle: "monthly",
    weekday: null,
    dayOfMonth,
    intervalMonths: null,
    anchorMonth: null,
    startDate,
    installmentsTotal,
  }) satisfies Schedule;

describe("a payment with installments ends at the Nth due date", () => {
  test.each<[string, Schedule, string[]]>([
    [
      "6 installments on the 15th",
      monthly(15, "2026-01-01", 6),
      ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15"],
    ],
    [
      "day 31 in short months (Feb 28, Apr 30)",
      monthly(31, "2026-01-31", 4),
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
    ],
    ["day 31 in a leap February", monthly(31, "2028-01-31", 2), ["2028-01-31", "2028-02-29"]],
    [
      "across the year",
      monthly(10, "2026-11-10", 4),
      ["2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10"],
    ],
    [
      "a start in the middle of the month: the first due date is the next one",
      monthly(15, "2026-01-20", 3),
      ["2026-02-15", "2026-03-15", "2026-04-15"],
    ],
    [
      "a start on the due day counts that day",
      monthly(15, "2026-01-15", 2),
      ["2026-01-15", "2026-02-15"],
    ],
    ["a single installment", monthly(5, "2026-03-01", 1), ["2026-03-05"]],
    [
      "no installments: it never ends (the first 3 shown)",
      monthly(5, "2026-03-01", null),
      ["2026-03-05", "2026-04-05", "2026-05-05"],
    ],
  ])("%s", (_name, schedule, expected) => {
    const found = dueDatesBetween(schedule, FOREVER.from, FOREVER.to);
    expect(schedule.installmentsTotal ? found : found.slice(0, 3)).toEqual(expected);
  });

  test("the last due date is the Nth, and nothing is generated after it", () => {
    const schedule = monthly(31, "2026-01-31", 4);
    expect(lastInstallmentDue(schedule)).toBe("2026-04-30");
    expect(dueDatesBetween(schedule, "2026-04-30", "2027-04-30")).toEqual(["2026-04-30"]);
    expect(dueDatesBetween(schedule, "2026-05-01", "2027-04-30")).toEqual([]);
    expect(isDueDate(schedule, "2026-04-30")).toBe(true);
    expect(isDueDate(schedule, "2026-05-31")).toBe(false);
    expect(lastInstallmentDue(monthly(31, "2026-01-31", null))).toBeNull();
  });

  test("a window that crosses the last due date stops there", () => {
    const schedule = monthly(15, "2026-06-15", 3); // Jun 15, Jul 15, Aug 15
    expect(dueDatesBetween(schedule, "2026-08-01", "2026-12-31")).toEqual(["2026-08-15"]);
    expect(dueDatesBetween(schedule, "2026-08-16", "2026-12-31")).toEqual([]);
  });

  test("only a monthly cycle has installments", () => {
    const weekly: Schedule = {
      cycle: "weekly",
      weekday: 1,
      dayOfMonth: null,
      intervalMonths: null,
      anchorMonth: null,
      startDate: "2026-10-05",
      installmentsTotal: 2,
    };
    expect(lastInstallmentDue(weekly)).toBeNull();
    expect(installmentNumber(weekly, "2026-10-12")).toBeNull();
    expect(dueDatesBetween(weekly, "2026-10-05", "2026-11-30")).toHaveLength(9);
  });
});

describe("the installment number is the position of the due date", () => {
  const schedule = monthly(31, "2026-01-31", 4);

  test.each([
    ["2026-01-31", 1],
    ["2026-02-28", 2],
    ["2026-03-31", 3],
    ["2026-04-30", 4],
    ["2026-05-31", null],
    ["2026-02-27", null],
    ["2025-12-31", null],
  ])("%s is cuota %s", (day, expected) => {
    expect(installmentNumber(schedule, day)).toBe(expected);
  });

  test("a start in the middle of the month: the first due date is cuota 1", () => {
    expect(installmentNumber(monthly(15, "2026-01-20", 3), "2026-02-15")).toBe(1);
  });

  test("no installments: no number", () => {
    expect(installmentNumber(monthly(15, "2026-01-01", null), "2026-02-15")).toBeNull();
  });

  test("an unbounded position, for the edit of N", () => {
    expect(monthlyPosition(schedule, "2026-04-30")).toBe(4);
    expect(monthlyPosition(schedule, "2026-09-30")).toBe(9);
    expect(monthlyPosition(schedule, "2025-12-31")).toBeNull();
  });
});

describe("pending periods, next due dates and the end of the plan", () => {
  // Today 2026-10-05: the window is 2026-08-06 … 2026-10-12.
  const today = "2026-10-05";

  test("the 60-day window shows the installments inside it", () => {
    expect(pendingPeriods(monthly(15, "2026-06-15", 6), new Set(), today)).toEqual([
      "2026-08-15",
      "2026-09-15",
    ]);
  });

  test("past the last installment nothing is pending", () => {
    // Jun, Jul and Aug only: September's 15th is not a 4th installment.
    expect(pendingPeriods(monthly(15, "2026-06-15", 3), new Set(), today)).toEqual(["2026-08-15"]);
    expect(pendingPeriods(monthly(15, "2026-06-15", 3), new Set(["2026-08-15"]), today)).toEqual(
      [],
    );
  });

  test("paid and skipped periods leave pending but never move the count", () => {
    const schedule = monthly(15, "2026-06-15", 6);
    const settled = new Set(["2026-08-15"]); // skipped or paid: the same for the count
    expect(pendingPeriods(schedule, settled, today)).toEqual(["2026-09-15"]);
    expect(installmentNumber(schedule, "2026-09-15")).toBe(4);
  });

  test("next due dates: fewer than asked when the plan ends, none after the last", () => {
    const schedule = monthly(15, "2026-06-15", 6); // …Nov 15
    expect(nextDueDates(schedule, "2026-10-05", 3)).toEqual(["2026-10-15", "2026-11-15"]);
    expect(nextDueDate(schedule, "2026-10-05")).toBe("2026-10-15");
    expect(nextDueDate(schedule, "2026-11-16")).toBeNull();
    expect(nextDueDates(schedule, "2027-01-01", 3)).toEqual([]);
  });

  test("next open due skips settled ones and ends with null", () => {
    const schedule = monthly(15, "2026-06-15", 6);
    expect(nextOpenDue(schedule, "2026-10-05", new Set(["2026-10-15"]))).toBe("2026-11-15");
    expect(nextOpenDue(schedule, "2026-10-05", new Set(["2026-10-15", "2026-11-15"]))).toBeNull();
  });

  test("startFrom keeps an ended plan as it is", () => {
    const schedule = monthly(15, "2026-06-15", 3);
    expect(startFrom(schedule, "2026-12-01")).toBe(schedule);
    expect(startFrom(monthly(15, "2026-06-15", 6), "2026-10-05").startDate).toBe("2026-10-15");
  });
});

const ITEM: RecurringItem = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Notebook",
  amountCents: 25_000,
  currency: "PEN",
  category: null,
  paymentMethod: null,
  cycle: "monthly",
  weekday: null,
  dayOfMonth: 15,
  intervalMonths: null,
  anchorMonth: null,
  startDate: "2026-06-15",
  installmentsTotal: 6,
  notes: null,
  archived: false,
};

describe("the home DTO and the copy", () => {
  test("the pending period carries its installment (number, total)", () => {
    expect(installmentOf(ITEM, "2026-09-15")).toEqual({ number: 4, total: 6 });
    expect(installmentOf({ ...ITEM, installmentsTotal: null }, "2026-09-15")).toBeNull();
    const [row] = toFinanceTodayItems([{ recurring: ITEM, dueOn: "2026-10-15" }]);
    expect(row.installment).toEqual({ number: 5, total: 6 });
    const [plain] = toFinanceTodayItems([
      { recurring: { ...ITEM, installmentsTotal: null }, dueOn: "2026-10-15" },
    ]);
    expect(plain.installment).toBeNull();
  });

  test("Cuota 3 de 6 and the cycle summary", () => {
    expect(installmentLabel({ number: 3, total: 6 })).toBe("Cuota 3 de 6");
    expect(installmentsCount(1)).toBe("1 cuota");
    expect(installmentsCount(6)).toBe("6 cuotas");
    expect(cycleSummary(ITEM)).toBe("Mensual, día 15 · 6 cuotas");
    expect(cycleSummary({ ...ITEM, installmentsTotal: 1 })).toBe("Mensual, día 15 · 1 cuota");
    expect(cycleSummary({ ...ITEM, installmentsTotal: null })).toBe("Mensual, día 15");
    expect(cycleSummary({ ...ITEM, cycle: "yearly", anchorMonth: 3 })).toBe("Anual, 15 mar");
  });

  test("the message of an N below what is settled names the lowest N", () => {
    expect(RECURRING_ERRORS.installmentsTooLow(4)).toBe(
      "Ya hay 4 cuotas pagadas u omitidas: escribe 4 o más.",
    );
  });
});

describe("borders of the count", () => {
  test("a start on Feb 28 with day 31 and N = 3: Feb 28, Mar 31, Apr 30", () => {
    expect(dueDatesBetween(monthly(31, "2026-02-28", 3), "2026-01-01", "2026-12-31")).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  test("across the year with day 31 and N = 3: Dec 31, Jan 31, Feb 28", () => {
    const schedule = monthly(31, "2026-12-31", 3);
    expect(dueDatesBetween(schedule, "2026-01-01", "2028-01-01")).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
    ]);
    expect(installmentNumber(schedule, "2027-02-28")).toBe(3);
  });
});

describe("a plan that ended unsettled shows as Terminado", () => {
  const today = "2026-10-05"; // the window starts 2026-08-06
  const item = (values: Partial<RecurringItem>): RecurringItem => ({
    ...ITEM,
    ...values,
  });

  test("its last installment older than the window: ended, in Archivados, not in Todos", () => {
    const old = item({
      id: "55555555-5555-4555-8555-0000000000a1",
      startDate: "2026-01-05",
      installmentsTotal: 2,
    });
    const live = item({ id: "55555555-5555-4555-8555-0000000000a2", name: "Vivo" });
    expect(isEnded(old, today)).toBe(true);
    expect(isEnded(live, today)).toBe(false);
    // Positive control: the last installment on the window's first day is not ended.
    expect(
      isEnded(item({ startDate: "2026-07-06", dayOfMonth: 6, installmentsTotal: 2 }), today),
    ).toBe(false);
    const view = buildPaymentsView([old, live], [], today);
    expect(view.active.map((entry) => entry.recurring.name)).toEqual(["Vivo"]);
    expect(view.thisMonth.map((entry) => entry.recurring.name)).toEqual(["Vivo"]);
    expect(view.archived.map((entry) => entry.id)).toEqual([old.id]);
    expect(view.archived[0].archived).toBe(false);
  });

  test("payments without installments never end", () => {
    expect(isEnded(item({ installmentsTotal: null, startDate: "2020-01-05" }), today)).toBe(false);
  });
});

describe("the sheet's schema: Termina después de N pagos", () => {
  const valid = {
    name: "Notebook",
    variable: false,
    amount: "250",
    currency: "PEN",
    categoryId: "",
    paymentMethodId: null,
    cycle: "monthly",
    weekday: 3,
    dayOfMonth: 15,
    intervalMonths: 3,
    anchorMonth: 4,
    startDate: "2026-10-05",
    notes: "",
  };
  const parse = (extra: Record<string, unknown>) =>
    createRecurringInputSchema.safeParse({ ...valid, ...extra });
  const messages = (extra: Record<string, unknown>) => {
    const result = parse(extra);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  test("a whole number from 1 to 120 on a monthly payment is stored", () => {
    for (const total of [1, 6, 120]) {
      const result = parse({ installmentsTotal: total });
      expect(result.success && result.data.installmentsTotal).toBe(total);
    }
  });

  test("empty, null or left out is none", () => {
    for (const extra of [{ installmentsTotal: null }, {}, { installmentsTotal: undefined }]) {
      const result = parse(extra);
      expect(result.success && result.data.installmentsTotal).toBeNull();
    }
  });

  test.each([0, -1, 121, 2.5, Number.NaN, "6"])("%s is refused", (total) => {
    expect(messages({ installmentsTotal: total })).toEqual([RECURRING_ERRORS.installmentsRange]);
  });

  test.each(["weekly", "every_n_months", "yearly"])("%s cannot have installments", (cycle) => {
    expect(messages({ cycle, installmentsTotal: 6 })).toEqual([RECURRING_ERRORS.installmentsCycle]);
    const result = parse({ cycle, installmentsTotal: null });
    expect(result.success && result.data.installmentsTotal).toBeNull();
  });

  test("editing takes the same field", () => {
    const result = updateRecurringInputSchema.safeParse({
      ...valid,
      id: "44444444-4444-4444-8444-444444444444",
      installmentsTotal: 12,
    });
    expect(result.success && result.data.installmentsTotal).toBe(12);
  });
});
