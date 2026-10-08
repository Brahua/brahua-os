// reminders → slots.ts: when each reminder is due, in Lima (UTC-5 all year), and the 2 h window.
import { describe, expect, test } from "vitest";
import { GRACE_WINDOW_MS } from "@/modules/reminders/reminders-constants";
import {
  addDaysToKey,
  briefingSlot,
  eveningReviewSlot,
  habitTimeSlot,
  limaDayOf,
  limaInstant,
  minutesOfTime,
  paymentEveSlot,
  paymentFollowupSlot,
  toHourMinute,
  windowState,
} from "@/modules/reminders/slots";

describe("limaInstant", () => {
  test("07:30 in Lima is 12:30 UTC", () => {
    expect(limaInstant("2026-10-08", "07:30").toISOString()).toBe("2026-10-08T12:30:00.000Z");
  });

  test("23:59 is still the Lima day: it falls on the next UTC day", () => {
    const instant = limaInstant("2026-10-08", "23:59");
    expect(instant.toISOString()).toBe("2026-10-09T04:59:00.000Z");
    expect(limaDayOf(instant)).toBe("2026-10-08");
  });

  test("midnight is the very start of the Lima day: 05:00 UTC of the same date", () => {
    const instant = limaInstant("2026-10-08", "00:00");
    expect(instant.toISOString()).toBe("2026-10-08T05:00:00.000Z");
    expect(limaDayOf(instant)).toBe("2026-10-08");
    // One minute earlier is the day before.
    expect(limaDayOf(new Date(instant.getTime() - 60_000))).toBe("2026-10-07");
  });

  test("crosses months and years", () => {
    expect(limaInstant("2026-12-31", "23:30").toISOString()).toBe("2027-01-01T04:30:00.000Z");
    expect(limaInstant("2028-02-29", "00:00").toISOString()).toBe("2028-02-29T05:00:00.000Z");
  });

  test("accepts the seconds Postgres adds to a time", () => {
    expect(limaInstant("2026-10-08", "07:30:00").toISOString()).toBe("2026-10-08T12:30:00.000Z");
  });

  test("rejects an invalid day or time instead of guessing", () => {
    expect(() => limaInstant("2026-10-8", "07:30")).toThrow(/Invalid slot/);
    expect(() => limaInstant("2026-10-08", "24:00")).toThrow(/Invalid slot/);
    expect(() => limaInstant("2026-10-08", "7:30")).toThrow(/Invalid slot/);
  });
});

describe("day arithmetic", () => {
  test("addDaysToKey", () => {
    expect(addDaysToKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToKey("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDaysToKey("2026-12-30", 3)).toBe("2027-01-02");
    expect(() => addDaysToKey("nope", 1)).toThrow();
  });

  test("limaDayOf reads the owner's day by arithmetic", () => {
    expect(limaDayOf(new Date("2026-10-08T04:59:59.999Z"))).toBe("2026-10-07");
    expect(limaDayOf(new Date("2026-10-08T05:00:00.000Z"))).toBe("2026-10-08");
  });

  test("minutesOfTime and toHourMinute", () => {
    expect(minutesOfTime("07:30")).toBe(450);
    expect(minutesOfTime("23:59:00")).toBe(1439);
    expect(minutesOfTime("25:00")).toBeNull();
    expect(toHourMinute("07:30:00")).toBe("07:30");
  });
});

describe("the slots of each reminder", () => {
  test("briefing and evening review are on the day, at their configured time", () => {
    expect(briefingSlot("2026-10-08", "07:30").toISOString()).toBe("2026-10-08T12:30:00.000Z");
    expect(eveningReviewSlot("2026-10-08", "21:00").toISOString()).toBe("2026-10-09T02:00:00.000Z");
  });

  test("the eve of a payment is the day before, at the briefing time", () => {
    // Due Thu 15 Oct: the reminder is Wed 14 Oct 07:30 Lima.
    expect(paymentEveSlot("2026-10-15", "07:30").toISOString()).toBe("2026-10-14T12:30:00.000Z");
    // Due the 1st: the eve is the last day of the previous month.
    expect(paymentEveSlot("2026-11-01", "07:30").toISOString()).toBe("2026-10-31T12:30:00.000Z");
  });

  test("the follow-up is 3 days after the due day, at the briefing time", () => {
    expect(paymentFollowupSlot("2026-10-05", "07:30").toISOString()).toBe(
      "2026-10-08T12:30:00.000Z",
    );
    expect(paymentFollowupSlot("2026-12-29", "08:00").toISOString()).toBe(
      "2027-01-01T13:00:00.000Z",
    );
  });

  test("a habit's time is its own", () => {
    expect(habitTimeSlot("2026-10-08", "22:00").toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });
});

describe("windowState (2 h of grace)", () => {
  const due = limaInstant("2026-10-08", "07:30");
  const at = (ms: number) => new Date(due.getTime() + ms);

  test("early before it is due", () => {
    expect(windowState(due, at(-1))).toBe("early");
    expect(windowState(due, at(-60 * 60 * 1000))).toBe("early");
  });

  test("open from the exact moment until just before two hours later", () => {
    expect(windowState(due, at(0))).toBe("open");
    expect(windowState(due, at(GRACE_WINDOW_MS - 1))).toBe("open");
  });

  test("expired from two hours on", () => {
    expect(windowState(due, at(GRACE_WINDOW_MS))).toBe("expired");
    expect(windowState(due, at(GRACE_WINDOW_MS + 6 * 60 * 60 * 1000))).toBe("expired");
  });

  test("a window that crosses midnight stays open across it (23:30 + 2 h)", () => {
    const late = limaInstant("2026-10-08", "23:30");
    const afterMidnight = new Date(late.getTime() + 60 * 60 * 1000); // 00:30 of the 9th in Lima
    expect(limaDayOf(afterMidnight)).toBe("2026-10-09");
    expect(windowState(late, afterMidnight)).toBe("open");
  });
});
