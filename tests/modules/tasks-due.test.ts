// T1: due labels of tasks by Lima's calendar day ("Retrasada" is derived, never stored).
import { describe, expect, test } from "vitest";
import { isUrgentDue, taskDueState } from "@/modules/tasks/task-due";

// 2026-10-02 in Lima runs from 05:00 UTC on the 2nd to 04:59:59 UTC on the 3rd.
const LIMA_MORNING = new Date("2026-10-02T15:00:00Z");
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");

const label = (dueDate: string | null, now: Date, doneAt: Date | null = null) =>
  taskDueState(dueDate, doneAt, now)?.label ?? null;

describe("taskDueState", () => {
  test("no date or done: nothing to say (a done task is never late)", () => {
    expect(taskDueState(null, null, LIMA_MORNING)).toBeNull();
    expect(taskDueState("2026-09-01", LIMA_MORNING, LIMA_MORNING)).toBeNull();
  });

  test("today, tomorrow, soon, later and late", () => {
    expect(label("2026-10-02", LIMA_MORNING)).toBe("Vence hoy");
    expect(label("2026-10-03", LIMA_MORNING)).toBe("Vence mañana");
    expect(label("2026-10-04", LIMA_MORNING)).toBe("Vence en 2 días");
    expect(label("2026-10-09", LIMA_MORNING)).toBe("Vence en 7 días");
    expect(label("2026-10-10", LIMA_MORNING)).toBe("Vence el 10 oct. 2026");
    expect(label("2026-10-01", LIMA_MORNING)).toBe("Retrasada hace 1 día");
    expect(label("2026-09-22", LIMA_MORNING)).toBe("Retrasada hace 10 días");
  });

  test("Lima's day, not UTC's: at 23:59:59 in Lima it is still today; at 00:00 it is late", () => {
    // UTC already says the 3rd at 04:59:59; Lima still says the 2nd.
    expect(label("2026-10-02", LIMA_LAST_SECOND)).toBe("Vence hoy");
    expect(label("2026-10-02", LIMA_MIDNIGHT)).toBe("Retrasada hace 1 día");
    expect(label("2026-10-03", LIMA_MIDNIGHT)).toBe("Vence hoy");
  });

  test("across months and years", () => {
    expect(label("2027-01-01", new Date("2026-12-31T15:00:00Z"))).toBe("Vence mañana");
    expect(label("2026-12-31", new Date("2027-01-01T15:00:00Z"))).toBe("Retrasada hace 1 día");
  });

  test("overdue and today are urgent; the rest are not", () => {
    expect(isUrgentDue(taskDueState("2026-10-01", null, LIMA_MORNING))).toBe(true);
    expect(isUrgentDue(taskDueState("2026-10-02", null, LIMA_MORNING))).toBe(true);
    expect(isUrgentDue(taskDueState("2026-10-03", null, LIMA_MORNING))).toBe(false);
    expect(isUrgentDue(null)).toBe(false);
  });
});
