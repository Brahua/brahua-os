// H4 of `habits`: the streak rules of SPEC-habits "Rachas y cumplimiento" as tables of cases
// (streak.ts, pure): daily, fixed days and "X por semana"; today and this week never break; paused
// days are neutral even with a log; the start date; the proportional quota; habits to avoid;
// the historical target; month, year and leap-day changes; the best streak; the milestones; and
// the day states and week compliance H5 reuses.
import { describe, expect, test } from "vitest";
import {
  availableDaysInWeek,
  bestStreak,
  currentStreak,
  dayStatus,
  isDoneOn,
  reachedMilestone,
  shownStreak,
  streakChoice,
  weekCompliance,
  weekStatus,
  type DayLog,
  type StreakHistory,
  type StreakRules,
} from "@/modules/habits/streak";
import { addDays } from "@/modules/habits/schedule";

// Friday 2026-10-02 in Lima; its week starts on Monday 2026-09-28.
const TODAY = "2026-10-02";

const daily = (startDate = "2026-01-01"): StreakRules => ({
  kind: "build",
  frequency: "daily",
  weeklyTarget: null,
  weekdays: null,
  startDate,
});

const fixedDays = (weekdays: number[], startDate = "2026-01-01"): StreakRules => ({
  ...daily(startDate),
  frequency: "weekdays",
  weekdays,
});

const weekly = (weeklyTarget: number, startDate = "2026-01-01"): StreakRules => ({
  ...daily(startDate),
  frequency: "weekly_count",
  weeklyTarget,
});

const avoid = (startDate = "2026-01-01"): StreakRules => ({ ...daily(startDate), kind: "avoid" });

type HistoryInput = {
  /** Days logged as done (a yes/no: 1 of 1). For a habit to avoid: relapses. */
  marked?: string[];
  /** Days with an explicit quantity and target. */
  logs?: Record<string, DayLog>;
  /** Pauses, both ends included. */
  pauses?: [string, string][];
};

function history({ marked = [], logs = {}, pauses = [] }: HistoryInput = {}): StreakHistory {
  const map = new Map<string, DayLog>(marked.map((day) => [day, { quantity: 1, target: 1 }]));
  for (const [day, log] of Object.entries(logs)) map.set(day, log);
  return {
    logs: map,
    pauses: pauses.map(([startDate, endDate]) => ({ startDate, endDate })),
  };
}

/** The `count` days before `last`, `last` included (oldest first). */
function run(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(last, index - count + 1));
}

type Case = {
  name: string;
  habit: StreakRules;
  input: HistoryInput;
  today?: string;
  current: number;
  best?: number;
};

function check(cases: Case[]) {
  test.each(cases)("$name", ({ habit, input, today = TODAY, current, best }) => {
    const data = history(input);
    expect(currentStreak(habit, data, today).count).toBe(current);
    if (best !== undefined) expect(bestStreak(habit, data, today).count).toBe(best);
  });
}

describe("daily streak (days)", () => {
  check([
    { name: "no logs: 0", habit: daily(), input: {}, current: 0, best: 0 },
    {
      name: "today not done doesn't break: the run up to yesterday",
      habit: daily(),
      input: { marked: ["2026-09-30", "2026-10-01"] },
      current: 2,
      best: 2,
    },
    {
      name: "today done adds",
      habit: daily(),
      input: { marked: ["2026-09-30", "2026-10-01", "2026-10-02"] },
      current: 3,
      best: 3,
    },
    {
      name: "only today done: 1",
      habit: daily(),
      input: { marked: [TODAY] },
      current: 1,
    },
    {
      name: "an open day before yesterday ends it",
      habit: daily(),
      input: { marked: ["2026-09-28", "2026-10-01"] },
      current: 1,
      best: 1,
    },
    {
      name: "yesterday open: 0 even with older days done",
      habit: daily(),
      input: { marked: run("2026-09-30", 5) },
      current: 0,
      best: 5,
    },
    {
      name: "stops at the start date (no days before it)",
      habit: daily("2026-09-30"),
      input: { marked: ["2026-09-30", "2026-10-01"] },
      current: 2,
      best: 2,
    },
    {
      name: "a habit starting today: today done is 1, not done is 0",
      habit: daily(TODAY),
      input: { marked: [TODAY] },
      current: 1,
    },
    {
      name: "a start date after today: 0",
      habit: daily("2026-10-05"),
      input: { marked: [TODAY] },
      current: 0,
      best: 0,
    },
    {
      name: "a pause in the middle neither breaks nor adds",
      habit: daily(),
      input: {
        marked: ["2026-09-25", "2026-09-26", "2026-09-30", "2026-10-01"],
        pauses: [["2026-09-27", "2026-09-29"]],
      },
      current: 4,
      best: 4,
    },
    {
      name: "a paused day with a log doesn't add",
      habit: daily(),
      input: {
        marked: ["2026-09-29", "2026-09-30", "2026-10-01"],
        pauses: [["2026-09-30", "2026-09-30"]],
      },
      current: 2,
      best: 2,
    },
    {
      name: "a pause at the start (right after the start date)",
      habit: daily("2026-09-20"),
      input: { marked: run("2026-10-01", 6), pauses: [["2026-09-20", "2026-09-25"]] },
      current: 6,
      best: 6,
    },
    {
      name: "a pause covering today: neutral, its log doesn't add",
      habit: daily(),
      input: { marked: ["2026-09-30", "2026-10-01", TODAY], pauses: [[TODAY, "2026-10-09"]] },
      current: 2,
    },
    {
      name: "a pause that ended yesterday, nothing done since: still the run before it",
      habit: daily(),
      input: { marked: ["2026-09-25", "2026-09-26"], pauses: [["2026-09-27", "2026-10-01"]] },
      current: 2,
    },
    {
      name: "historical target: a day done by its own target counts after the goal was raised",
      habit: daily(),
      input: {
        logs: {
          "2026-09-30": { quantity: 8, target: 8 },
          "2026-10-01": { quantity: 8, target: 8 },
          [TODAY]: { quantity: 8, target: 10 },
        },
      },
      current: 2,
    },
    {
      name: "historical target: under that day's target is open (8 of 10)",
      habit: daily(),
      input: {
        logs: {
          "2026-09-30": { quantity: 8, target: 8 },
          "2026-10-01": { quantity: 8, target: 10 },
        },
      },
      current: 0,
      best: 1,
    },
    {
      name: "a quantity past its target is done (10 of 8)",
      habit: daily(),
      input: { logs: { "2026-10-01": { quantity: 10, target: 8 } } },
      current: 1,
    },
    {
      name: "a partial quantity today doesn't break (3 of 8)",
      habit: daily(),
      input: {
        logs: { "2026-10-01": { quantity: 8, target: 8 }, [TODAY]: { quantity: 3, target: 8 } },
      },
      current: 1,
    },
    {
      name: "an unmarked day (quantity 0) is open",
      habit: daily(),
      input: { logs: { "2026-10-01": { quantity: 0, target: 1 } }, marked: ["2026-09-30"] },
      current: 0,
      best: 1,
    },
    {
      name: "across a month change",
      habit: daily(),
      today: "2026-10-01",
      input: { marked: ["2026-09-29", "2026-09-30"] },
      current: 2,
    },
    {
      name: "across a year change",
      habit: daily(),
      today: "2027-01-02",
      input: { marked: ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"] },
      current: 4,
    },
    {
      name: "across a leap day",
      habit: daily(),
      today: "2028-03-01",
      input: { marked: ["2028-02-28", "2028-02-29"] },
      current: 2,
    },
    {
      name: "a long run: a whole year",
      habit: daily("2025-10-02"),
      input: { marked: run("2026-10-01", 365) },
      current: 365,
      best: 365,
    },
  ]);
});

describe("fixed days streak (days; the other weekdays are ignored)", () => {
  // Monday, Wednesday and Friday.
  const mwf = fixedDays([1, 3, 5]);
  check([
    {
      name: "only the scheduled days count; today (Friday) open doesn't break",
      habit: mwf,
      input: { marked: ["2026-09-25", "2026-09-28", "2026-09-30"] },
      current: 3,
      best: 3,
    },
    {
      name: "today (Friday) done adds",
      habit: mwf,
      input: { marked: ["2026-09-28", "2026-09-30", TODAY] },
      current: 3,
    },
    {
      name: "an open scheduled day (Monday) ends it",
      habit: mwf,
      input: { marked: ["2026-09-25", "2026-09-30"] },
      current: 1,
      best: 1,
    },
    {
      name: "a log on an unscheduled day (Tuesday) doesn't count",
      habit: mwf,
      input: { marked: ["2026-09-29"] },
      current: 0,
      best: 0,
    },
    {
      name: "today not scheduled: the run of the scheduled days before",
      habit: fixedDays([1, 3]),
      input: { marked: ["2026-09-28", "2026-09-30"] },
      current: 2,
    },
    {
      name: "a paused scheduled day is neutral",
      habit: mwf,
      input: { marked: ["2026-09-25", "2026-09-30"], pauses: [["2026-09-28", "2026-09-28"]] },
      current: 2,
    },
    {
      name: "across a year change (Wednesday 2026-12-30, Friday 2027-01-01, Monday 2027-01-04)",
      habit: mwf,
      today: "2027-01-05",
      input: { marked: ["2026-12-30", "2027-01-01", "2027-01-04"] },
      current: 3,
    },
  ]);
});

describe("X por semana streak (weeks)", () => {
  // Weeks (Monday): 09-07, 09-14, 09-21, and the current one, 09-28 (today is Friday 10-02).
  check([
    {
      name: "this week not met yet doesn't break: the met weeks before",
      habit: weekly(3),
      input: {
        marked: [
          ...["2026-09-14", "2026-09-16", "2026-09-18"],
          ...["2026-09-21", "2026-09-22", "2026-09-27"],
          ...["2026-09-28", "2026-09-29"],
        ],
      },
      current: 2,
      best: 2,
    },
    {
      name: "this week met adds",
      habit: weekly(3),
      input: {
        marked: [
          ...["2026-09-21", "2026-09-22", "2026-09-27"],
          ...["2026-09-28", "2026-09-29", TODAY],
        ],
      },
      current: 2,
    },
    {
      name: "a week under its quota ends it",
      habit: weekly(3),
      input: {
        marked: [
          ...["2026-09-14", "2026-09-16", "2026-09-18"],
          ...["2026-09-21", "2026-09-22"],
          ...["2026-09-28", "2026-09-29", "2026-09-30"],
        ],
      },
      current: 1,
      best: 1,
    },
    {
      name: "a week can be passed (4 of 3)",
      habit: weekly(3),
      input: { marked: run("2026-09-27", 4) },
      current: 1,
    },
    {
      name: "a fully paused week is neutral (skipped)",
      habit: weekly(2),
      input: {
        marked: ["2026-09-07", "2026-09-08", "2026-09-21", "2026-09-22"],
        pauses: [["2026-09-14", "2026-09-20"]],
      },
      current: 2,
      best: 2,
    },
    {
      name: "a paused week with logs is still neutral (they don't count)",
      habit: weekly(2),
      input: {
        marked: ["2026-09-07", "2026-09-08", "2026-09-14", "2026-09-21", "2026-09-22"],
        pauses: [["2026-09-14", "2026-09-20"]],
      },
      current: 2,
    },
    {
      name: "proportional quota: 3 available days of 3x ask for ceil(9/7) = 2",
      habit: weekly(3),
      input: { marked: ["2026-09-25", "2026-09-26"], pauses: [["2026-09-21", "2026-09-24"]] },
      current: 1,
    },
    {
      name: "proportional quota: 1 available day of 3x asks for 1",
      habit: weekly(3),
      input: { marked: ["2026-09-27"], pauses: [["2026-09-21", "2026-09-26"]] },
      current: 1,
    },
    {
      name: "a start date mid-week asks for its part: Thursday on, 4 days of 3x is 2",
      habit: weekly(3, "2026-09-24"),
      input: { marked: ["2026-09-24", "2026-09-27"] },
      current: 1,
      best: 1,
    },
    {
      name: "a start date mid-week, under its part: open (1 of 2), and nothing before it",
      habit: weekly(3, "2026-09-24"),
      input: { marked: ["2026-09-27"] },
      current: 0,
    },
    {
      name: "a pause later this week lowers this week's quota: 2 available of 6x asks for 2",
      habit: weekly(6, "2026-09-28"),
      input: { marked: ["2026-09-28", "2026-09-29"], pauses: [["2026-09-30", "2026-10-04"]] },
      current: 1,
    },
    {
      name: "this week fully paused from Monday: neutral, the weeks before count",
      habit: weekly(2),
      input: {
        marked: ["2026-09-21", "2026-09-22", "2026-09-28"],
        pauses: [["2026-09-28", "2026-10-04"]],
      },
      current: 1,
    },
    {
      name: "a past week met only with paused days' logs is open and breaks",
      habit: weekly(2),
      input: {
        marked: [
          "2026-09-14",
          "2026-09-15",
          "2026-09-21",
          "2026-09-22",
          "2026-09-28",
          "2026-09-29",
        ],
        pauses: [["2026-09-21", "2026-09-22"]],
      },
      // This week met (1); last week 0 of ceil(2 × 5 / 7) = 2 is open: it breaks the run (best 1).
      current: 1,
      best: 1,
    },
    {
      name: "across a year change (the week of Monday 2026-12-28)",
      habit: weekly(2),
      today: "2027-01-06",
      input: { marked: ["2026-12-21", "2026-12-22", "2026-12-31", "2027-01-02"] },
      current: 2,
    },
  ]);
});

describe("a habit to avoid (clean days, today included)", () => {
  check([
    {
      name: "no relapses since the start: every day, today included",
      habit: avoid("2026-09-26"),
      input: {},
      current: 7,
      best: 7,
    },
    {
      name: "after a relapse: the clean days since",
      habit: avoid(),
      input: { marked: ["2026-09-29"] },
      current: 3,
    },
    {
      name: "a relapse today leaves it at 0 (the best stays)",
      habit: avoid("2026-09-26"),
      input: { marked: [TODAY] },
      current: 0,
      best: 6,
    },
    {
      name: "a relapse yesterday: today, still clean, is 1",
      habit: avoid(),
      input: { marked: ["2026-10-01"] },
      current: 1,
    },
    {
      name: "a habit to avoid starting today: 1",
      habit: avoid(TODAY),
      input: {},
      current: 1,
    },
    {
      name: "an unmarked relapse (quantity 0) is a clean day",
      habit: avoid("2026-09-30"),
      input: { logs: { "2026-10-01": { quantity: 0, target: 1 } } },
      current: 3,
    },
    {
      name: "a paused day with a relapse is neutral",
      habit: avoid("2026-09-28"),
      input: { marked: ["2026-09-30"], pauses: [["2026-09-30", "2026-09-30"]] },
      current: 4,
    },
  ]);
});

describe("best streak", () => {
  check([
    {
      name: "the longest run of the history",
      habit: daily("2026-09-01"),
      input: { marked: [...run("2026-09-05", 3), ...run("2026-09-20", 5), ...run(TODAY, 2)] },
      current: 2,
      best: 5,
    },
    {
      name: "the current run can be the best",
      habit: daily("2026-09-01"),
      input: { marked: [...run("2026-09-05", 3), ...run("2026-10-01", 9)] },
      current: 9,
      best: 9,
    },
    {
      name: "weeks: the longest run of met weeks",
      habit: weekly(1, "2026-08-03"),
      input: {
        // Met: 08-03, 08-10, 08-17; open: 08-24; met: 08-31, 09-07; open: 09-14, 09-21.
        marked: ["2026-08-03", "2026-08-12", "2026-08-23", "2026-09-01", "2026-09-13"],
      },
      current: 0,
      best: 3,
    },
  ]);
});

describe("streakChoice and shownStreak (the pad's optimistic streak)", () => {
  test("daily: either way today could end", () => {
    const data = history({ marked: ["2026-09-30", "2026-10-01"] });
    const choice = streakChoice(daily(), data, TODAY);
    expect(choice).toEqual({ unit: "days", done: 3, notDone: 2 });
    expect(shownStreak(choice, true)).toEqual({ count: 3, unit: "days" });
    expect(shownStreak(choice, false)).toEqual({ count: 2, unit: "days" });
  });

  test("today already logged: notDone takes it away (it is the 'Deshacer' view)", () => {
    const choice = streakChoice(daily(), history({ marked: ["2026-10-01", TODAY] }), TODAY);
    expect(choice).toEqual({ unit: "days", done: 2, notDone: 1 });
  });

  test("a quantity: done fills today's own target", () => {
    const data = history({
      logs: { "2026-10-01": { quantity: 8, target: 8 }, [TODAY]: { quantity: 3, target: 10 } },
    });
    expect(streakChoice(daily(), data, TODAY)).toEqual({ unit: "days", done: 2, notDone: 1 });
  });

  test("weeks: today done can meet this week", () => {
    const data = history({ marked: ["2026-09-21", "2026-09-28", "2026-09-29"] });
    expect(streakChoice(weekly(3), data, TODAY)).toEqual({ unit: "weeks", done: 1, notDone: 0 });
  });

  test("a habit to avoid: done is clean today, notDone is a relapse (0)", () => {
    const choice = streakChoice(avoid("2026-09-26"), history(), TODAY);
    expect(choice).toEqual({ unit: "days", done: 7, notDone: 0 });
  });

  test("today paused or not scheduled: both the same", () => {
    const paused = history({ marked: ["2026-10-01"], pauses: [[TODAY, TODAY]] });
    expect(streakChoice(daily(), paused, TODAY)).toEqual({ unit: "days", done: 1, notDone: 1 });
    const notToday = history({ marked: ["2026-09-28"] });
    expect(streakChoice(fixedDays([1]), notToday, TODAY)).toEqual({
      unit: "days",
      done: 1,
      notDone: 1,
    });
  });
});

describe("milestones", () => {
  test.each([
    [6, 7, 7],
    [29, 30, 30],
    [89, 90, 90],
    [364, 365, 365],
    [7, 7, null],
    [7, 8, null],
    [8, 7, null],
    [0, 1, null],
    [366, 367, null],
  ])("from %i to %i: %s", (before, after, expected) => {
    expect(reachedMilestone(before, after)).toBe(expected);
  });
});

describe("weekStatus and available days", () => {
  test("a week with a pause and a start date: available days and the quota", () => {
    const habit = weekly(3, "2026-09-23");
    const data = history({
      marked: ["2026-09-23", "2026-09-26"],
      pauses: [["2026-09-25", "2026-09-26"]],
    });
    expect(availableDaysInWeek(habit, data.pauses, "2026-09-21")).toBe(3);
    // Wednesday and Thursday and Sunday are available; Saturday's log is paused.
    expect(weekStatus(habit, data, "2026-09-21", TODAY)).toEqual({ done: 1, quota: 2 });
  });
});

describe("dayStatus (H5's calendar)", () => {
  const water = daily("2026-09-27");
  const data = history({
    logs: {
      "2026-09-28": { quantity: 8, target: 8 },
      "2026-09-29": { quantity: 3, target: 8 },
      "2026-09-30": { quantity: 8, target: 8 },
    },
    pauses: [["2026-09-30", "2026-09-30"]],
  });
  test.each([
    ["2026-09-26", "beforeStart"],
    ["2026-09-27", "empty"],
    ["2026-09-28", "done"],
    ["2026-09-29", "partial"],
    ["2026-09-30", "paused"],
    [TODAY, "empty"],
    ["2026-10-03", "future"],
  ])("%s is %s", (day, expected) => {
    expect(dayStatus(water, data, day, TODAY)).toBe(expected);
  });

  test("an unscheduled day of a fixed-days habit, and a relapse is never partial", () => {
    expect(
      dayStatus(fixedDays([1]), history({ marked: ["2026-09-29"] }), "2026-09-29", TODAY),
    ).toBe("notScheduled");
    expect(dayStatus(avoid(), history({ marked: ["2026-09-29"] }), "2026-09-29", TODAY)).toBe(
      "empty",
    );
  });
});

describe("weekCompliance (H5's week view)", () => {
  test("daily: done over elapsed available days; today only once done", () => {
    const data = history({
      marked: ["2026-09-28", "2026-09-30"],
      pauses: [["2026-09-29", "2026-09-29"]],
    });
    expect(weekCompliance(daily(), data, "2026-09-28", TODAY)).toEqual({ done: 2, expected: 3 });
    const doneToday = history({ marked: ["2026-09-28", TODAY] });
    expect(weekCompliance(daily(), doneToday, "2026-09-28", TODAY)).toEqual({
      done: 2,
      expected: 5,
    });
  });

  test("a past week counts every day; fixed days only theirs", () => {
    const data = history({ marked: ["2026-09-21", "2026-09-23", "2026-09-24"] });
    expect(weekCompliance(daily(), data, "2026-09-21", TODAY)).toEqual({ done: 3, expected: 7 });
    expect(weekCompliance(fixedDays([1, 3, 5]), data, "2026-09-21", TODAY)).toEqual({
      done: 2,
      expected: 3,
    });
  });

  test("X por semana: done days over the quota ('2 de 3')", () => {
    const data = history({ marked: ["2026-09-28", "2026-09-29"] });
    expect(weekCompliance(weekly(3), data, "2026-09-28", TODAY)).toEqual({ done: 2, expected: 3 });
  });

  test("a habit to avoid: clean days over elapsed available days", () => {
    const data = history({ marked: ["2026-09-29"] });
    expect(weekCompliance(avoid(), data, "2026-09-28", TODAY)).toEqual({ done: 4, expected: 5 });
  });
});

describe("invariants over many random histories", () => {
  test(
    "best ≥ current ≥ 0; a done today never lowers it; the pad's pick is the server's streak",
    { timeout: 30_000 },
    () => {
      // A small seeded PRNG: the same cases on every run.
      let seed = 42;
      const random = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed / 2_147_483_648;
      };
      const kinds: StreakRules[] = [
        daily("2026-08-01"),
        fixedDays([1, 3, 5], "2026-08-01"),
        weekly(3, "2026-08-01"),
        avoid("2026-08-01"),
      ];
      const mismatches: string[] = [];
      for (let index = 0; index < 2_000; index += 1) {
        const habit = kinds[index % kinds.length];
        // Done, partial (3 of 8) or empty days, with targets that changed over time.
        const logs: Record<string, DayLog> = {};
        for (let day = "2026-08-01"; day <= TODAY; day = addDays(day, 1)) {
          const roll = random();
          const target = day < "2026-09-15" ? 8 : 10;
          if (roll < 0.6) logs[day] = { quantity: target + (random() < 0.2 ? 2 : 0), target };
          else if (roll < 0.75) logs[day] = { quantity: 3, target };
        }
        const pauses: [string, string][] = [];
        for (let count = 0; count < 2; count += 1) {
          if (random() < 0.5) {
            const start = addDays("2026-08-01", Math.floor(random() * 62));
            pauses.push([start, addDays(start, Math.floor(random() * 10))]);
          }
        }
        const data = history({ logs, pauses });
        const current = currentStreak(habit, data, TODAY).count;
        const best = bestStreak(habit, data, TODAY).count;
        const choice = streakChoice(habit, data, TODAY);
        if (current < 0 || best < current)
          mismatches.push(`#${index}: current ${current}, best ${best}`);
        if (choice.done < choice.notDone)
          mismatches.push(`#${index}: choice ${JSON.stringify(choice)}`);
        // What the pad shows (today's own state) is what the server counts.
        const shown = shownStreak(choice, isDoneOn(habit, data, TODAY)).count;
        if (shown !== current) mismatches.push(`#${index}: shown ${shown}, current ${current}`);
      }
      expect(mismatches).toEqual([]);
    },
  );
});
