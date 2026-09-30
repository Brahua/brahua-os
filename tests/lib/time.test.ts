import { describe, expect, test } from "vitest";
import { formatLongDate, greetingFor, ownerDateKey, ownerHour } from "@/lib/time";

// Lima is UTC-5 all year (no daylight saving time), so these UTC instants map to fixed Lima times.
const lima = (isoLocal: string) => new Date(`${isoLocal}-05:00`);

describe("greetingFor (Lima time)", () => {
  test.each([
    ["2026-09-30T00:00:00", "Buenas noches"],
    ["2026-09-30T04:59:59", "Buenas noches"],
    ["2026-09-30T05:00:00", "Buenos días"],
    ["2026-09-30T11:59:59", "Buenos días"],
    ["2026-09-30T12:00:00", "Buenas tardes"],
    ["2026-09-30T18:59:59", "Buenas tardes"],
    ["2026-09-30T19:00:00", "Buenas noches"],
    ["2026-09-30T23:59:59", "Buenas noches"],
  ])("%s → %s", (time, greeting) => {
    expect(greetingFor(lima(time))).toBe(greeting);
  });

  test("uses Lima's hour, not UTC's", () => {
    // 15:00 UTC is 10:00 in Lima: morning there, afternoon in UTC.
    const instant = new Date("2026-09-30T15:00:00Z");
    expect(ownerHour(instant)).toBe(10);
    expect(greetingFor(instant)).toBe("Buenos días");
  });
});

describe("dates (Lima time)", () => {
  test("formats the long date in Spanish (Peru), capitalized", () => {
    expect(formatLongDate(lima("2026-09-30T09:00:00"))).toBe("Miércoles, 30 de setiembre");
  });

  test("the day changes at Lima's midnight, not UTC's", () => {
    // 2026-10-01 03:00 UTC is still 22:00 on September 30 in Lima.
    const lateEvening = new Date("2026-10-01T03:00:00Z");
    expect(ownerDateKey(lateEvening)).toBe("2026-09-30");
    expect(formatLongDate(lateEvening)).toBe("Miércoles, 30 de setiembre");
    expect(greetingFor(lateEvening)).toBe("Buenas noches");

    const midnight = lima("2026-10-01T00:00:00");
    expect(ownerDateKey(midnight)).toBe("2026-10-01");
    expect(formatLongDate(midnight)).toBe("Jueves, 1 de octubre");
  });

  test("ownerHour is 0–23 (no 24 at midnight)", () => {
    expect(ownerHour(lima("2026-09-30T00:30:00"))).toBe(0);
    expect(ownerHour(lima("2026-09-30T23:30:00"))).toBe(23);
  });
});
