// R4 of `reminders`: the `habit_time` candidates of the `habits` source on a fixed clock: keys, the
// instant each is due, the 2 h window (23:59 and 00:15 Lima, the exact edges), what crosses
// midnight, the switch, and several habits at the same minute, one notice each. Which habits get
// a candidate at all (done, paused, a evitar, other weekdays) is `timedHabitsLeft`'s, tested in
// habits-reminder.test.ts; the database side in tests/integration/reminders-habit-times.test.ts.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { habitTimeCandidates, habitsReminderSource } from "@/modules/habits/reminders-source";
import type { ReminderContext } from "@/modules/reminders/contracts";
import { addDaysToKey, limaDayOf, limaInstant, windowState } from "@/modules/reminders/slots";

const db = vi.hoisted(() => ({
  selectTimedHabitsLeft: vi.fn(),
  selectHabitsTodaySummary: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/habits/contracts", () => db);

const LEER = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Leer", reminderTime: "22:00" };
const MEDITAR = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Meditar",
  reminderTime: "22:00",
};
const YOGA = { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Yoga", reminderTime: "07:15" };

function context(now: Date, habitTime = true): ReminderContext {
  const today = limaDayOf(now);
  return {
    now,
    today,
    yesterday: addDaysToKey(today, -1),
    times: { briefing: "07:30", evening: "21:00" },
    enabled: {
      briefing: true,
      payment_eve: true,
      payment_followup: true,
      evening_review: true,
      habit_time: habitTime,
    },
  };
}

const habitTimeOf = async (now: Date, habitTime = true) =>
  (await habitsReminderSource.candidates(context(now, habitTime))).filter(
    (candidate) => candidate.kind === "habit_time",
  );

beforeEach(() => {
  db.selectTimedHabitsLeft.mockReset();
  db.selectTimedHabitsLeft.mockResolvedValue([]);
  db.selectHabitsTodaySummary.mockReset();
});

describe("habitTimeCandidates (pure)", () => {
  test("the key is one per habit and day; it is due at the habit's time in Lima", () => {
    const [candidate] = habitTimeCandidates("2026-10-08", [LEER]);
    expect(candidate.kind).toBe("habit_time");
    expect(candidate.dedupeKey).toBe(`habit:${LEER.id}:2026-10-08`);
    // 22:00 Lima is 03:00 UTC the next day.
    expect(candidate.dueAt.toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });

  test("«Es hora de Leer.»", async () => {
    const [candidate] = habitTimeCandidates("2026-10-08", [LEER]);
    expect(await candidate.build({ channel: "telegram", showAmounts: true })).toBe(
      "Es hora de Leer.",
    );
  });

  test("seconds that Postgres might add are ignored", () => {
    const [candidate] = habitTimeCandidates("2026-10-08", [{ ...LEER, reminderTime: "22:00:00" }]);
    expect(candidate.dueAt.toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });

  test("habits at the same minute: each its own key and its own sentence, none speaks for another", async () => {
    const candidates = habitTimeCandidates("2026-10-08", [LEER, YOGA, MEDITAR]);
    const options = { channel: "telegram", showAmounts: true } as const;
    const texts = await Promise.all(candidates.map((candidate) => candidate.build(options)));
    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      `habit:${LEER.id}:2026-10-08`,
      `habit:${YOGA.id}:2026-10-08`,
      `habit:${MEDITAR.id}:2026-10-08`,
    ]);
    expect(texts).toEqual(["Es hora de Leer.", "Es hora de Yoga.", "Es hora de Meditar."]);
    // Both 22:00 habits are due at the very same instant.
    expect(candidates[0].dueAt.getTime()).toBe(candidates[2].dueAt.getTime());
  });

  test("a different minute is a different sentence (positive control)", async () => {
    const candidates = habitTimeCandidates("2026-10-08", [
      LEER,
      { ...MEDITAR, reminderTime: "22:01" },
    ]);
    const options = { channel: "telegram", showAmounts: true } as const;
    expect(await Promise.all(candidates.map((candidate) => candidate.build(options)))).toEqual([
      "Es hora de Leer.",
      "Es hora de Meditar.",
    ]);
  });

  test("no habits, no candidates", () => {
    expect(habitTimeCandidates("2026-10-08", [])).toEqual([]);
  });
});

describe("the source's habit_time candidates", () => {
  test("the evening review is still the first candidate", async () => {
    db.selectTimedHabitsLeft.mockResolvedValue([LEER]);
    const all = await habitsReminderSource.candidates(context(limaInstant("2026-10-08", "22:00")));
    expect(all.map((candidate) => candidate.kind)).toEqual(["evening_review", "habit_time"]);
  });

  test("the switch off: no candidate and no query for habits", async () => {
    db.selectTimedHabitsLeft.mockResolvedValue([LEER]);
    expect(await habitTimeOf(limaInstant("2026-10-08", "22:00"), false)).toEqual([]);
    expect(db.selectTimedHabitsLeft).not.toHaveBeenCalled();
  });

  test("today's habits are read for the tick's instant", async () => {
    db.selectTimedHabitsLeft.mockResolvedValue([LEER]);
    const now = limaInstant("2026-10-08", "22:05");
    const [candidate] = await habitTimeOf(now);
    expect(db.selectTimedHabitsLeft).toHaveBeenLastCalledWith(expect.anything(), now);
    expect(candidate.dedupeKey).toBe(`habit:${LEER.id}:2026-10-08`);
  });

  test("the window is 2 h: open from the time, expired at exactly time + 2 h", async () => {
    db.selectTimedHabitsLeft.mockResolvedValue([LEER]);
    const [candidate] = await habitTimeOf(limaInstant("2026-10-08", "22:00"));
    const due = candidate.dueAt;
    const at = (ms: number) => new Date(due.getTime() + ms);
    expect(windowState(due, at(-1))).toBe("early");
    expect(windowState(due, at(0))).toBe("open");
    expect(windowState(due, at(2 * 60 * 60 * 1000 - 1))).toBe("open");
    expect(windowState(due, at(2 * 60 * 60 * 1000))).toBe("expired");
  });

  test("a habit at 23:59 is still open at 00:15 of the next Lima day, offered for the day that ended", async () => {
    db.selectTimedHabitsLeft.mockImplementation(async (_db: unknown, at: Date) =>
      limaDayOf(at) === "2026-10-08" ? [{ ...LEER, reminderTime: "23:59" }] : [],
    );
    const now = limaInstant("2026-10-09", "00:15");
    const candidates = await habitTimeOf(now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dedupeKey).toBe(`habit:${LEER.id}:2026-10-08`);
    expect(windowState(candidates[0].dueAt, now)).toBe("open");
    // Yesterday was read for yesterday's own day.
    const readDays = db.selectTimedHabitsLeft.mock.calls.map((call: unknown[]) =>
      limaDayOf(call[1] as Date),
    );
    expect(readDays).toEqual(["2026-10-08", "2026-10-09"]);
  });

  test("yesterday is read only while the latest possible time still has its window open (01:58 yes, 01:59 no)", async () => {
    await habitTimeOf(limaInstant("2026-10-09", "01:58"));
    expect(db.selectTimedHabitsLeft).toHaveBeenCalledTimes(2);

    db.selectTimedHabitsLeft.mockClear();
    await habitTimeOf(limaInstant("2026-10-09", "01:59"));
    expect(db.selectTimedHabitsLeft).toHaveBeenCalledTimes(1);
    expect(limaDayOf(db.selectTimedHabitsLeft.mock.calls[0][1])).toBe("2026-10-09");

    db.selectTimedHabitsLeft.mockClear();
    await habitTimeOf(limaInstant("2026-10-09", "12:00"));
    expect(db.selectTimedHabitsLeft).toHaveBeenCalledTimes(1);
  });

  test("at 23:59 of the day itself, nothing from yesterday is asked beyond its window", async () => {
    // 23:59 Lima on the 8th: yesterday (the 7th) 23:59 ended 22 h ago.
    await habitTimeOf(limaInstant("2026-10-08", "23:59"));
    expect(db.selectTimedHabitsLeft).toHaveBeenCalledTimes(1);
  });

  test("one habit at 22:00 yesterday is expired at 00:15 (its window closed at midnight): offered, but the engine skips it", async () => {
    db.selectTimedHabitsLeft.mockImplementation(async (_db: unknown, at: Date) =>
      limaDayOf(at) === "2026-10-08" ? [LEER] : [],
    );
    const now = limaInstant("2026-10-09", "00:15");
    const [candidate] = await habitTimeOf(now);
    expect(windowState(candidate.dueAt, now)).toBe("expired");
  });
});
