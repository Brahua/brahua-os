// T3: the next due date of a recurring task (SPEC-tasks criterion 6: the 5 rules in Lima time)
// and the rule in words.
import { describe, expect, test } from "vitest";
import { nextDueDate, recurrenceSummary } from "@/modules/tasks/recurrence";
import { RECURRENCE_ERRORS } from "@/modules/tasks/recurrence-copy";
import { recurrenceRuleSchema } from "@/modules/tasks/recurrence-input";
import { createTaskInputSchema, type TaskRecurrence } from "@/modules/tasks/task-input";

const every = (kind: "every_days" | "every_weeks" | "every_months", interval: number) =>
  ({ kind, interval, weekdays: null, monthDay: null }) satisfies TaskRecurrence;
const weekdays = (...days: number[]): TaskRecurrence => ({
  kind: "weekdays",
  interval: null,
  weekdays: days,
  monthDay: null,
});
const monthDay = (day: number): TaskRecurrence => ({
  kind: "month_day",
  interval: null,
  weekdays: null,
  monthDay: day,
});

/** Noon in Lima (17:00 UTC) of a calendar day: well away from either midnight. */
const limaNoon = (key: string) => new Date(`${key}T17:00:00Z`);

const DAY_MS = 86_400_000;
const keyPlusDays = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const isoWeekday = (key: string) => {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Every calendar day from `from` (inclusive), `count` of them. */
const daysFrom = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) => keyPlusDays(from, index));

describe("Lima's day, not UTC's", () => {
  // 2026-10-02 in Lima runs from 05:00 UTC on the 2nd to 04:59:59.999 UTC on the 3rd.
  test("at 23:59:59 in Lima it still counts from the 2nd; at 00:00 from the 3rd", () => {
    expect(nextDueDate(every("every_days", 1), new Date("2026-10-03T04:59:59.999Z"))).toBe(
      "2026-10-03",
    );
    expect(nextDueDate(every("every_days", 1), new Date("2026-10-03T05:00:00Z"))).toBe(
      "2026-10-04",
    );
    // Early morning in UTC is still the previous evening in Lima.
    expect(nextDueDate(every("every_days", 3), new Date("2026-10-02T02:00:00Z"))).toBe(
      "2026-10-04",
    );
  });

  test("tomorrow is Lima's tomorrow for weekdays and the day of the month", () => {
    // Fri 2026-10-02 23:30 in Lima (Sat 04:30 UTC): Saturday is tomorrow, not today.
    const lateFriday = new Date("2026-10-03T04:30:00Z");
    expect(nextDueDate(weekdays(6), lateFriday)).toBe("2026-10-03");
    expect(nextDueDate(monthDay(3), lateFriday)).toBe("2026-10-03");
    // At Lima's midnight it is Saturday: the next Saturday is a week later.
    const saturday = new Date("2026-10-03T05:00:00Z");
    expect(nextDueDate(weekdays(6), saturday)).toBe("2026-10-10");
    expect(nextDueDate(monthDay(3), saturday)).toBe("2026-11-03");
  });

  test("no DST in Lima: every hour of a year counts from that Lima day", () => {
    // UTC−5 all year: for every hour of 2027, the base day is the UTC instant minus 5 hours.
    for (let hour = 0; hour < 365 * 24; hour++) {
      const instant = new Date(Date.UTC(2027, 0, 1) + hour * 3_600_000);
      const limaDay = new Date(instant.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
      expect(nextDueDate(every("every_days", 1), instant)).toBe(keyPlusDays(limaDay, 1));
    }
  });
});

describe("every N days / weeks, from the completion day", () => {
  test("examples across month and year ends and leap days", () => {
    expect(nextDueDate(every("every_days", 3), limaNoon("2026-10-02"))).toBe("2026-10-05");
    expect(nextDueDate(every("every_days", 1), limaNoon("2026-10-31"))).toBe("2026-11-01");
    expect(nextDueDate(every("every_days", 1), limaNoon("2026-12-31"))).toBe("2027-01-01");
    expect(nextDueDate(every("every_days", 1), limaNoon("2028-02-28"))).toBe("2028-02-29");
    expect(nextDueDate(every("every_days", 1), limaNoon("2027-02-28"))).toBe("2027-03-01");
    expect(nextDueDate(every("every_days", 365), limaNoon("2027-03-01"))).toBe("2028-02-29");
    expect(nextDueDate(every("every_weeks", 1), limaNoon("2026-12-28"))).toBe("2027-01-04");
    expect(nextDueDate(every("every_weeks", 2), limaNoon("2028-02-20"))).toBe("2028-03-05");
  });

  test.each(["2026-10-02", "2027-12-31", "2028-02-29", "2026-01-31"])(
    "every interval 1–365 from %s",
    (from) => {
      for (let n = 1; n <= 365; n++) {
        expect(nextDueDate(every("every_days", n), limaNoon(from))).toBe(keyPlusDays(from, n));
        expect(nextDueDate(every("every_weeks", n), limaNoon(from))).toBe(keyPlusDays(from, n * 7));
      }
    },
  );
});

describe("every N months, from the completion day (clamped to the month's end)", () => {
  test("the end of the month clamps", () => {
    expect(nextDueDate(every("every_months", 1), limaNoon("2027-01-31"))).toBe("2027-02-28");
    expect(nextDueDate(every("every_months", 1), limaNoon("2028-01-31"))).toBe("2028-02-29");
    expect(nextDueDate(every("every_months", 1), limaNoon("2026-03-31"))).toBe("2026-04-30");
    expect(nextDueDate(every("every_months", 2), limaNoon("2027-01-31"))).toBe("2027-03-31");
    expect(nextDueDate(every("every_months", 3), limaNoon("2026-11-30"))).toBe("2027-02-28");
    expect(nextDueDate(every("every_months", 1), limaNoon("2026-12-15"))).toBe("2027-01-15");
    expect(nextDueDate(every("every_months", 12), limaNoon("2028-02-29"))).toBe("2029-02-28");
    expect(nextDueDate(every("every_months", 48), limaNoon("2028-02-29"))).toBe("2032-02-29");
    expect(nextDueDate(every("every_months", 365), limaNoon("2026-10-02"))).toBe("2057-03-02");
  });

  test.each(["2026-01-31", "2027-12-31", "2028-02-29", "2026-10-02", "2026-05-30"])(
    "every interval 1–365 from %s: N months later, the same day or the month's last",
    (from) => {
      const [year, month, day] = from.split("-").map(Number);
      for (let n = 1; n <= 365; n++) {
        const total = month - 1 + n;
        const y = year + Math.floor(total / 12);
        const m = (total % 12) + 1;
        const d = Math.min(day, daysInMonth(y, m));
        const expected = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        expect(nextDueDate(every("every_months", n), limaNoon(from))).toBe(expected);
      }
    },
  );
});

describe("weekdays: the first matching day from tomorrow", () => {
  test("examples", () => {
    // 2026-10-02 is a Friday.
    expect(nextDueDate(weekdays(1, 4), limaNoon("2026-10-02"))).toBe("2026-10-05");
    expect(nextDueDate(weekdays(5), limaNoon("2026-10-02"))).toBe("2026-10-09");
    expect(nextDueDate(weekdays(6, 7), limaNoon("2026-10-02"))).toBe("2026-10-03");
    // Across the year's end: Thu 2026-12-31 → Mon 2027-01-04.
    expect(nextDueDate(weekdays(1), limaNoon("2026-12-31"))).toBe("2027-01-04");
    // Leap day: Mon 2028-02-28 → Tue 2028-02-29.
    expect(nextDueDate(weekdays(2), limaNoon("2028-02-28"))).toBe("2028-02-29");
  });

  test("every combination of weekdays (127) from every weekday", () => {
    const week = daysFrom("2026-09-28", 7); // Monday to Sunday
    for (let mask = 1; mask < 128; mask++) {
      const days = [1, 2, 3, 4, 5, 6, 7].filter((day) => mask & (1 << (day - 1)));
      for (const today of week) {
        const next = nextDueDate(weekdays(...days), limaNoon(today));
        const offset = (Date.parse(next) - Date.parse(today)) / DAY_MS;
        expect(offset).toBeGreaterThanOrEqual(1);
        expect(offset).toBeLessThanOrEqual(7);
        expect(days).toContain(isoWeekday(next));
        // No earlier matching day was skipped.
        for (let earlier = 1; earlier < offset; earlier++) {
          expect(days).not.toContain(isoWeekday(keyPlusDays(today, earlier)));
        }
      }
    }
  });
});

describe("day X of the month: the first one from tomorrow (clamped)", () => {
  test("examples", () => {
    expect(nextDueDate(monthDay(15), limaNoon("2026-10-02"))).toBe("2026-10-15");
    expect(nextDueDate(monthDay(15), limaNoon("2026-10-15"))).toBe("2026-11-15");
    expect(nextDueDate(monthDay(15), limaNoon("2026-10-14"))).toBe("2026-10-15");
    expect(nextDueDate(monthDay(1), limaNoon("2026-12-31"))).toBe("2027-01-01");
    expect(nextDueDate(monthDay(31), limaNoon("2027-02-10"))).toBe("2027-02-28");
    expect(nextDueDate(monthDay(31), limaNoon("2028-02-10"))).toBe("2028-02-29");
    expect(nextDueDate(monthDay(30), limaNoon("2027-02-28"))).toBe("2027-03-30");
    expect(nextDueDate(monthDay(31), limaNoon("2026-04-30"))).toBe("2026-05-31");
    expect(nextDueDate(monthDay(29), limaNoon("2027-01-29"))).toBe("2027-02-28");
  });

  // ~22,600 cases: collect mismatches and assert once (an `expect` per probe timed out on CI runners).
  test("every day 1–31 from every day of 2027 and 2028 (a leap year)", { timeout: 30_000 }, () => {
    const failures: string[] = [];
    for (const today of daysFrom("2027-01-01", 731)) {
      for (let target = 1; target <= 31; target++) {
        const next = nextDueDate(monthDay(target), limaNoon(today));
        const [y, m, d] = next.split("-").map(Number);
        if (next <= today) failures.push(`${today} day ${target}: ${next} is not after today`);
        if (d !== Math.min(target, daysInMonth(y, m))) {
          failures.push(`${today} day ${target}: ${next} is the wrong day`);
        }
        // No earlier day from tomorrow fits.
        for (let probe = keyPlusDays(today, 1); probe < next; probe = keyPlusDays(probe, 1)) {
          const [py, pm, pd] = probe.split("-").map(Number);
          if (pd === Math.min(target, daysInMonth(py, pm))) {
            failures.push(`${today} day ${target}: ${probe} fits before ${next}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("completed early: weekdays and a day of the month start after the due date", () => {
  test("examples (decision of review round 1)", () => {
    // Friday 2026-10-02, due Friday the 9th, every Friday: the next is the 16th, not the 9th.
    expect(nextDueDate(weekdays(5), limaNoon("2026-10-02"), "2026-10-09")).toBe("2026-10-16");
    // Day 15, due the 15th, completed on the 2nd: November, not October.
    expect(nextDueDate(monthDay(15), limaNoon("2026-10-02"), "2026-10-15")).toBe("2026-11-15");
    // Due before today (late) or today: from tomorrow, as without a due date.
    expect(nextDueDate(weekdays(6), limaNoon("2026-10-02"), "2026-09-20")).toBe("2026-10-03");
    expect(nextDueDate(weekdays(6), limaNoon("2026-10-02"), "2026-10-02")).toBe("2026-10-03");
    // Due on the last day of the year: from January 1.
    expect(nextDueDate(monthDay(1), limaNoon("2026-12-20"), "2026-12-31")).toBe("2027-01-01");
    // Interval rules keep counting from the completion day.
    expect(nextDueDate(every("every_days", 3), limaNoon("2026-10-02"), "2026-10-20")).toBe(
      "2026-10-05",
    );
    expect(nextDueDate(every("every_months", 1), limaNoon("2026-10-02"), "2027-01-01")).toBe(
      "2026-11-02",
    );
  });

  test("always after both today and the due date, and the first day that fits", () => {
    const today = "2026-10-02";
    for (const due of daysFrom("2026-09-25", 50)) {
      const from = [keyPlusDays(today, 1), keyPlusDays(due, 1)].sort()[1];
      for (let mask = 1; mask < 128; mask += 3) {
        const days = [1, 2, 3, 4, 5, 6, 7].filter((day) => mask & (1 << (day - 1)));
        const next = nextDueDate(weekdays(...days), limaNoon(today), due);
        expect(next >= from).toBe(true);
        expect(days).toContain(isoWeekday(next));
        for (let probe = from; probe < next; probe = keyPlusDays(probe, 1)) {
          expect(days).not.toContain(isoWeekday(probe));
        }
      }
      for (let target = 1; target <= 31; target++) {
        const next = nextDueDate(monthDay(target), limaNoon(today), due);
        const [y, m, d] = next.split("-").map(Number);
        expect(next >= from).toBe(true);
        expect(d).toBe(Math.min(target, daysInMonth(y, m)));
      }
    }
  });
});

describe("recurrenceSummary", () => {
  test.each<[TaskRecurrence, string]>([
    [every("every_days", 1), "Cada día desde que la completas"],
    [every("every_days", 3), "Cada 3 días desde que la completas"],
    [every("every_weeks", 1), "Cada semana desde que la completas"],
    [every("every_weeks", 2), "Cada 2 semanas desde que la completas"],
    [every("every_months", 1), "Cada mes desde que la completas"],
    [every("every_months", 6), "Cada 6 meses desde que la completas"],
    [weekdays(1), "Los lunes"],
    [weekdays(1, 4), "Los lunes y jueves"],
    [weekdays(1, 3, 5), "Los lunes, miércoles y viernes"],
    [weekdays(6, 7), "Los sábados y domingos"],
    [weekdays(1, 2, 3, 4, 5), "De lunes a viernes"],
    [weekdays(1, 2, 3, 4, 5, 6, 7), "Todos los días"],
    [weekdays(2, 3, 4, 5, 6, 7), "Los martes, miércoles, jueves, viernes, sábados y domingos"],
    [monthDay(1), "El día 1 de cada mes"],
    [monthDay(15), "El día 15 de cada mes"],
    [monthDay(29), "El día 29 de cada mes (o el último, si el mes es más corto)"],
    [monthDay(30), "El día 30 de cada mes (o el último, si el mes es más corto)"],
    [monthDay(31), "El último día de cada mes"],
  ])("%j → %s", (rule, text) => {
    expect(recurrenceSummary(rule)).toBe(text);
  });
});

describe("recurrenceRuleSchema", () => {
  test("each rule, in the stored shape (fields of other rules dropped, weekdays sorted and unique)", () => {
    expect(
      recurrenceRuleSchema.parse({ kind: "every_days", interval: "3", weekdays: [1] }),
    ).toEqual(every("every_days", 3));
    expect(recurrenceRuleSchema.parse({ kind: "weekdays", weekdays: [4, 1, 4] })).toEqual(
      weekdays(1, 4),
    );
    expect(recurrenceRuleSchema.parse({ kind: "month_day", monthDay: 31 })).toEqual(monthDay(31));
  });

  test.each<[Record<string, unknown>, string]>([
    [{ kind: "every_days", interval: 0 }, RECURRENCE_ERRORS.interval],
    [{ kind: "every_weeks", interval: 366 }, RECURRENCE_ERRORS.interval],
    [{ kind: "every_months", interval: 1.5 }, RECURRENCE_ERRORS.interval],
    [{ kind: "every_months" }, RECURRENCE_ERRORS.interval],
    [{ kind: "every_days", interval: "" }, RECURRENCE_ERRORS.interval],
    [{ kind: "every_days", interval: "3x" }, RECURRENCE_ERRORS.interval],
    [{ kind: "weekdays", weekdays: [] }, RECURRENCE_ERRORS.weekdays],
    [{ kind: "weekdays", weekdays: [0] }, RECURRENCE_ERRORS.weekdays],
    [{ kind: "weekdays", weekdays: [8] }, RECURRENCE_ERRORS.weekdays],
    [{ kind: "weekdays" }, RECURRENCE_ERRORS.weekdays],
    [{ kind: "month_day", monthDay: 0 }, RECURRENCE_ERRORS.monthDay],
    [{ kind: "month_day", monthDay: 32 }, RECURRENCE_ERRORS.monthDay],
    [{ kind: "yearly" }, RECURRENCE_ERRORS.kind],
    [{}, RECURRENCE_ERRORS.kind],
  ])("%j is refused", (input, message) => {
    const result = recurrenceRuleSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(message);
  });

  test("quick capture takes an optional rule", () => {
    expect(createTaskInputSchema.parse({ title: "regar" }).recurrence).toBeUndefined();
    expect(createTaskInputSchema.parse({ title: "regar", recurrence: null }).recurrence).toBeNull();
    expect(
      createTaskInputSchema.parse({
        title: "regar",
        recurrence: { kind: "every_days", interval: 3 },
      }).recurrence,
    ).toEqual(every("every_days", 3));
    expect(
      createTaskInputSchema.safeParse({
        title: "regar",
        recurrence: { kind: "weekdays", weekdays: [] },
      }).success,
    ).toBe(false);
  });
});
