// W1 of `weekly-review`: the pure week rules (SPEC-weekly-review "Decisiones": Qué semana,
// Invitación). Big tables of cases; Lima is UTC-5 with no daylight saving, so 05:00Z is Lima's
// midnight, Sunday 18:00 Lima is 23:00Z and Monday 23:59 Lima is 04:59Z of Tuesday.
import { describe, expect, test } from "vitest";
import {
  addDays,
  currentWeekStart,
  defaultReviewWeek,
  inviteWeek,
  isDateKey,
  isMonday,
  isReviewableWeek,
  isoWeekday,
  mondayOf,
  moveTargets,
  nextMonday,
  parseWeekParam,
  previousMonday,
  reviewInvite,
  sundayOf,
  weekLabel,
  weekRange,
} from "@/modules/weekly-review/week";

// 2026-10-12 is a Monday; the week ends on Sunday 2026-10-18.
const at = (iso: string) => new Date(iso);

describe("day helpers", () => {
  test.each([
    ["2026-10-12", "2026-10-12"],
    ["2026-10-13", "2026-10-12"],
    ["2026-10-18", "2026-10-12"],
    ["2026-10-19", "2026-10-19"],
    // Month change.
    ["2026-11-01", "2026-10-26"],
    ["2026-10-31", "2026-10-26"],
    // Year change.
    ["2027-01-01", "2026-12-28"],
    ["2026-12-31", "2026-12-28"],
    ["2027-01-03", "2026-12-28"],
    ["2027-01-04", "2027-01-04"],
    // Leap year (2028 is leap, 2100 is not).
    ["2028-02-29", "2028-02-28"],
    ["2028-03-01", "2028-02-28"],
    ["2028-03-05", "2028-02-28"],
    ["2024-02-29", "2024-02-26"],
  ])("the Monday of %s is %s", (day, monday) => {
    expect(mondayOf(day)).toBe(monday);
    expect(isMonday(monday)).toBe(true);
  });

  test.each([
    ["2026-10-12", "2026-10-18"],
    ["2026-09-28", "2026-10-04"],
    ["2026-12-28", "2027-01-03"],
    ["2028-02-28", "2028-03-05"],
    ["2028-02-21", "2028-02-27"],
  ])("the Sunday of the week of %s is %s", (monday, sunday) => {
    expect(sundayOf(monday)).toBe(sunday);
    expect(isoWeekday(sunday)).toBe(7);
  });

  test.each([
    ["2026-10-12", "2026-10-19", "2026-10-05"],
    ["2026-12-28", "2027-01-04", "2026-12-21"],
    ["2028-02-21", "2028-02-28", "2028-02-14"],
    ["2028-02-28", "2028-03-06", "2028-02-21"],
  ])("around %s: next %s, previous %s", (monday, next, previous) => {
    expect(nextMonday(monday)).toBe(next);
    expect(previousMonday(monday)).toBe(previous);
  });

  test("addDays crosses months, years and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test.each([
    ["2026-10-12", true, true],
    ["2026-10-13", true, false],
    ["2026-02-30", false, false],
    ["2026-1-5", false, false],
    ["", false, false],
    ["lunes", false, false],
  ])("%s: real day %s, Monday %s", (value, real, monday) => {
    expect(isDateKey(value)).toBe(real);
    expect(isMonday(value)).toBe(monday);
  });
});

describe("the current week (Lima)", () => {
  test.each([
    // Lima's midnight: 04:59Z is still Sunday, 05:00Z is Monday.
    ["2026-10-19T04:59:00Z", "2026-10-12"],
    ["2026-10-19T05:00:00Z", "2026-10-19"],
    ["2026-10-20T04:59:00Z", "2026-10-19"],
    ["2026-10-20T05:00:00Z", "2026-10-19"],
    ["2026-10-13T03:00:00Z", "2026-10-12"],
    // Year change: Thursday 2026-12-31 Lima evening is already 2027-01-01 in UTC.
    ["2027-01-01T03:00:00Z", "2026-12-28"],
    ["2027-01-04T04:59:00Z", "2026-12-28"],
    ["2027-01-04T05:00:00Z", "2027-01-04"],
  ])("%s is in the week of %s", (iso, monday) => {
    expect(currentWeekStart(at(iso))).toBe(monday);
  });
});

describe("the week to review by default", () => {
  // [instant, previous week reviewed, expected]
  test.each([
    // Sunday: always the week in progress.
    ["2026-10-18T15:00:00Z", false, "2026-10-12"],
    ["2026-10-18T15:00:00Z", true, "2026-10-12"],
    // Monday and Tuesday with the previous week still open: that one.
    ["2026-10-19T05:00:00Z", false, "2026-10-12"],
    ["2026-10-19T17:00:00Z", false, "2026-10-12"],
    ["2026-10-20T04:59:00Z", false, "2026-10-12"],
    ["2026-10-20T05:00:00Z", false, "2026-10-12"],
    ["2026-10-21T04:59:00Z", false, "2026-10-12"],
    // ...and once it is reviewed, the week in progress.
    ["2026-10-19T05:00:00Z", true, "2026-10-19"],
    ["2026-10-20T15:00:00Z", true, "2026-10-19"],
    // Wednesday on: the week in progress even when the previous one was never closed.
    ["2026-10-21T05:00:00Z", false, "2026-10-19"],
    ["2026-10-22T15:00:00Z", false, "2026-10-19"],
    ["2026-10-25T15:00:00Z", false, "2026-10-19"],
    // Month and year changes: Monday 2027-01-04 looks back to 2026-12-28.
    ["2027-01-04T10:00:00Z", false, "2026-12-28"],
    ["2026-11-02T10:00:00Z", false, "2026-10-26"],
    // Leap day on a Tuesday: the previous week starts 2028-02-21.
    ["2028-02-29T15:00:00Z", false, "2028-02-21"],
  ])("%s (previous reviewed: %s) → %s", (iso, reviewed, expected) => {
    expect(defaultReviewWeek(at(iso), reviewed as boolean)).toBe(expected);
  });
});

describe("?semana=", () => {
  const now = at("2026-10-14T15:00:00Z"); // Wednesday 2026-10-14, week of 2026-10-12
  test.each([
    ["2026-10-12", "2026-10-12"],
    ["2026-10-05", "2026-10-05"],
    ["2025-01-06", "2025-01-06"],
    // Not a Monday, not a day, not in the past or present.
    ["2026-10-13", null],
    ["2026-10-18", null],
    ["2026-10-19", null],
    ["2027-01-04", null],
    ["2026-02-30", null],
    ["12-10-2026", null],
    ["", null],
    [undefined, null],
    [["2026-10-12", "2026-10-05"], null],
  ])("%j → %j", (value, expected) => {
    expect(parseWeekParam(value as string | undefined, now)).toBe(expected);
    expect(isReviewableWeek(typeof value === "string" ? value : "", now)).toBe(expected !== null);
  });

  test("the week in progress is reviewable from its Monday's Lima midnight", () => {
    expect(parseWeekParam("2026-10-19", at("2026-10-19T04:59:00Z"))).toBeNull();
    expect(parseWeekParam("2026-10-19", at("2026-10-19T05:00:00Z"))).toBe("2026-10-19");
  });
});

describe("the invitation window", () => {
  // [instant, week offered by the clock]
  test.each([
    // Sunday 2026-10-18: 17:59 Lima (22:59Z) no, 18:00 (23:00Z) yes.
    ["2026-10-18T05:00:00Z", null],
    ["2026-10-18T22:59:00Z", null],
    ["2026-10-18T23:00:00Z", "2026-10-12"],
    ["2026-10-18T23:30:00Z", "2026-10-12"],
    // Sunday 23:59 Lima is 04:59Z of Monday: still the same Sunday.
    ["2026-10-19T04:59:00Z", "2026-10-12"],
    // Monday: the week that ended yesterday, all day, up to 23:59 Lima (04:59Z Tuesday).
    ["2026-10-19T05:00:00Z", "2026-10-12"],
    ["2026-10-19T17:00:00Z", "2026-10-12"],
    ["2026-10-20T04:59:00Z", "2026-10-12"],
    // Tuesday 00:00 Lima: closed.
    ["2026-10-20T05:00:00Z", null],
    ["2026-10-21T15:00:00Z", null],
    // Saturday, Friday, a Sunday morning.
    ["2026-10-17T23:30:00Z", null],
    ["2026-10-18T13:00:00Z", null],
    // Month change: Sunday 2026-11-01 18:00 Lima → week of 2026-10-26; Monday 2026-11-02 → same.
    ["2026-11-01T23:00:00Z", "2026-10-26"],
    ["2026-11-02T15:00:00Z", "2026-10-26"],
    // Year change: Sunday 2027-01-03 18:00 Lima → 2026-12-28; Monday 2027-01-04 → same.
    ["2027-01-03T23:00:00Z", "2026-12-28"],
    ["2027-01-04T15:00:00Z", "2026-12-28"],
    // Leap year: Sunday 2028-02-27 18:00 Lima → 2028-02-21; Monday 2028-02-28; Tuesday 02-29 closed.
    ["2028-02-27T23:00:00Z", "2028-02-21"],
    ["2028-02-28T15:00:00Z", "2028-02-21"],
    ["2028-02-29T15:00:00Z", null],
    // Sunday 2028-03-05 18:00 Lima (the Sunday after the leap day) → week of 2028-02-28.
    ["2028-03-05T23:00:00Z", "2028-02-28"],
  ])("%s → %j", (iso, expected) => {
    expect(inviteWeek(at(iso))).toBe(expected);
  });

  test("every hour of a whole week: only Sunday 18:00 to Monday 23:59 offers a week", () => {
    const offered: string[] = [];
    // Hourly from Monday 2026-10-12 00:00 Lima to Monday 2026-10-19 23:59 Lima.
    for (let hour = 0; hour < 24 * 8; hour += 1) {
      const instant = new Date(Date.parse("2026-10-12T05:00:00Z") + hour * 3_600_000);
      if (inviteWeek(instant) !== null) offered.push(instant.toISOString());
    }
    // Monday 2026-10-12 (the week before's invitation, 24 hours), Sunday 18:00–23:59 (6 hours)
    // and Monday 2026-10-19 (24 hours).
    expect(offered).toHaveLength(24 + 6 + 24);
    expect(offered[0]).toBe("2026-10-12T05:00:00.000Z");
    expect(offered[23]).toBe("2026-10-13T04:00:00.000Z");
    expect(offered[24]).toBe("2026-10-18T23:00:00.000Z");
  });

  test("a closed week offers nothing (positive control: the same instant offers it open)", () => {
    const sundayEvening = at("2026-10-18T23:00:00Z");
    expect(reviewInvite(sundayEvening, false)).toEqual({ weekStart: "2026-10-12" });
    expect(reviewInvite(sundayEvening, true)).toBeNull();
    const mondayNoon = at("2026-10-19T17:00:00Z");
    expect(reviewInvite(mondayNoon, false)).toEqual({ weekStart: "2026-10-12" });
    expect(reviewInvite(mondayNoon, true)).toBeNull();
    // Outside the window it is null whether the week is closed or not.
    expect(reviewInvite(at("2026-10-21T15:00:00Z"), false)).toBeNull();
  });
});

describe("where the tasks move", () => {
  // [reviewed week, instant, monday, tomorrow]
  test.each([
    // Sunday evening reviewing the week in progress: Monday next, and tomorrow is that Monday.
    ["2026-10-12", "2026-10-18T23:00:00Z", "2026-10-19", "2026-10-19"],
    // Wednesday reviewing the week in progress: tomorrow is Thursday.
    ["2026-10-12", "2026-10-14T15:00:00Z", "2026-10-19", "2026-10-15"],
    // Monday reviewing the week that just ended: both are today (the Monday).
    ["2026-10-12", "2026-10-19T15:00:00Z", "2026-10-19", "2026-10-19"],
    // Tuesday reviewing last week: the Monday has passed, so the next one; tomorrow is the same.
    ["2026-10-12", "2026-10-20T15:00:00Z", "2026-10-26", "2026-10-26"],
    // An old week, on a Monday: the first Monday on or after today is today.
    ["2026-09-21", "2026-10-19T15:00:00Z", "2026-10-19", "2026-10-19"],
    // Year change.
    ["2026-12-28", "2027-01-03T23:00:00Z", "2027-01-04", "2027-01-04"],
    // Lima midnight: 04:59Z of Monday is still Sunday (the week in progress), 05:00Z is Monday.
    ["2026-10-12", "2026-10-19T04:59:00Z", "2026-10-19", "2026-10-19"],
    ["2026-10-12", "2026-10-19T05:00:00Z", "2026-10-19", "2026-10-19"],
  ])("reviewing %s at %s → Monday %s, tomorrow %s", (week, iso, monday, tomorrow) => {
    expect(moveTargets(week, at(iso))).toEqual({ monday, tomorrow });
  });

  test("the targets are never before today", () => {
    for (const iso of ["2026-10-14T15:00:00Z", "2026-10-19T15:00:00Z", "2026-10-25T15:00:00Z"]) {
      const today = new Date(iso).toISOString().slice(0, 10);
      for (const week of ["2026-09-14", "2026-10-05", "2026-10-12", "2026-10-19"]) {
        const targets = moveTargets(week, at(iso));
        expect(targets.monday >= today).toBe(true);
        expect(targets.tomorrow >= today).toBe(true);
        expect(isMonday(targets.monday)).toBe(true);
      }
    }
  });
});

describe("labels", () => {
  test.each([
    ["2026-10-12", "12 al 18 de octubre", "Del 12 al 18 de octubre"],
    ["2026-10-19", "19 al 25 de octubre", "Del 19 al 25 de octubre"],
    // The month changes inside the week.
    ["2026-09-28", "28 de setiembre al 4 de octubre", "Del 28 de setiembre al 4 de octubre"],
    ["2026-10-26", "26 de octubre al 1 de noviembre", "Del 26 de octubre al 1 de noviembre"],
    // The year changes inside the week.
    [
      "2026-12-28",
      "28 de diciembre de 2026 al 3 de enero de 2027",
      "Del 28 de diciembre de 2026 al 3 de enero de 2027",
    ],
    // Leap day inside the week.
    ["2028-02-28", "28 de febrero al 5 de marzo", "Del 28 de febrero al 5 de marzo"],
    ["2028-02-21", "21 al 27 de febrero", "Del 21 al 27 de febrero"],
    // A whole month in the week's own month.
    ["2026-06-01", "1 al 7 de junio", "Del 1 al 7 de junio"],
  ])("%s", (week, range, label) => {
    expect(weekRange(week)).toBe(range);
    expect(weekLabel(week)).toBe(label);
  });
});
