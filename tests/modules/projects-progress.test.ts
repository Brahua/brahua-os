import { describe, expect, test } from "vitest";
import { daysUntil, dueState } from "@/modules/projects/progress";
import { PROJECT_STATUSES } from "@/modules/projects/project-constants";

// Lima is UTC-5 all year (no daylight saving): Lima midnight is 05:00 UTC.
const LIMA_MIDNIGHT_OCT_1 = new Date("2026-10-01T05:00:00.000Z");
const JUST_BEFORE = new Date("2026-10-01T04:59:59.999Z"); // still Sep 30 in Lima
const LATE_OCT_1 = new Date("2026-10-02T04:59:59.999Z"); // 23:59:59 Oct 1 in Lima, Oct 2 in UTC

describe("daysUntil (Lima calendar days)", () => {
  test("counts whole days from Lima's today", () => {
    expect(daysUntil("2026-10-01", LIMA_MIDNIGHT_OCT_1)).toBe(0);
    expect(daysUntil("2026-10-08", LIMA_MIDNIGHT_OCT_1)).toBe(7);
    expect(daysUntil("2026-09-28", LIMA_MIDNIGHT_OCT_1)).toBe(-3);
  });

  test("across months, years and a leap day", () => {
    expect(daysUntil("2027-01-01", new Date("2026-12-31T15:00:00Z"))).toBe(1);
    expect(daysUntil("2028-03-01", new Date("2028-02-28T15:00:00Z"))).toBe(2);
  });

  test("rejects a malformed date key", () => {
    expect(() => daysUntil("2026-10-1", LIMA_MIDNIGHT_OCT_1)).toThrow(/Invalid date key/);
  });
});

describe("dueState", () => {
  test("due today", () => {
    expect(dueState("2026-10-01", "active", LIMA_MIDNIGHT_OCT_1)).toEqual({
      kind: "today",
      days: 0,
      label: "Vence hoy",
    });
  });

  test("due in 1 to 7 days, singular for one", () => {
    expect(dueState("2026-10-02", "active", LIMA_MIDNIGHT_OCT_1)?.label).toBe("Vence en 1 día");
    expect(dueState("2026-10-04", "idea", LIMA_MIDNIGHT_OCT_1)).toEqual({
      kind: "soon",
      days: 3,
      label: "Vence en 3 días",
    });
    expect(dueState("2026-10-08", "paused", LIMA_MIDNIGHT_OCT_1)?.label).toBe("Vence en 7 días");
  });

  test("nothing more than a week ahead", () => {
    expect(dueState("2026-10-09", "active", LIMA_MIDNIGHT_OCT_1)).toBeNull();
  });

  test("overdue, singular for one day", () => {
    expect(dueState("2026-09-30", "active", LIMA_MIDNIGHT_OCT_1)).toEqual({
      kind: "overdue",
      days: 1,
      label: "Vencido hace 1 día",
    });
    expect(dueState("2026-08-02", "active", LIMA_MIDNIGHT_OCT_1)?.label).toBe(
      "Vencido hace 60 días",
    );
  });

  test("no due date, no notice", () => {
    expect(dueState(null, "active", LIMA_MIDNIGHT_OCT_1)).toBeNull();
  });

  test("only idea, active and paused show it; maintenance, done and canceled never", () => {
    const shown = PROJECT_STATUSES.filter(
      (status) => dueState("2026-09-01", status, LIMA_MIDNIGHT_OCT_1) !== null,
    );
    expect(shown).toEqual(["idea", "active", "paused"]);
  });

  describe("around Lima midnight", () => {
    test("one millisecond before midnight it is still the previous day", () => {
      // 23:59:59.999 on Sep 30 in Lima (04:59 UTC on Oct 1).
      expect(dueState("2026-10-01", "active", JUST_BEFORE)?.label).toBe("Vence en 1 día");
      expect(dueState("2026-09-30", "active", JUST_BEFORE)?.label).toBe("Vence hoy");
    });

    test("at midnight the day changes", () => {
      expect(dueState("2026-10-01", "active", LIMA_MIDNIGHT_OCT_1)?.label).toBe("Vence hoy");
      expect(dueState("2026-09-30", "active", LIMA_MIDNIGHT_OCT_1)?.label).toBe(
        "Vencido hace 1 día",
      );
    });

    test("late evening in Lima is already tomorrow in UTC, but still today for the owner", () => {
      expect(dueState("2026-10-01", "active", LATE_OCT_1)?.label).toBe("Vence hoy");
      expect(dueState("2026-10-08", "active", LATE_OCT_1)?.label).toBe("Vence en 7 días");
      expect(dueState("2026-10-09", "active", LATE_OCT_1)).toBeNull();
    });
  });
});
