// R4 of `reminders` in `habits` (pure parts): the Zod rules of the reminder time and the part of
// the day, the grouping of the pads by part of the day, and which habits get a `habit_time`
// reminder on a fixed clock. The database CHECKs and the source against Postgres are in
// tests/integration/reminders-habit-times.test.ts.
import { describe, expect, test } from "vitest";
import { groupByDaypart, visualOrder } from "@/modules/habits/daypart-groups";
import {
  createHabitInputSchema,
  type HabitItem,
  updateHabitInputSchema,
} from "@/modules/habits/habit-input";
import { reminderColumns, reminderUpdateColumns } from "@/modules/habits/reminder-input";
import { REMINDER_ERRORS } from "@/modules/habits/reminder-copy";
import { timedHabitsLeft } from "@/modules/habits/today-summary";

const ID = "11111111-1111-4111-8111-111111111111";

const create = (input: object) => createHabitInputSchema.safeParse({ name: "Leer", ...input });
const update = (input: object) =>
  updateHabitInputSchema.safeParse({ id: ID, name: "Leer", frequency: "daily", ...input });

function messagesOf(
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
) {
  return (result.error?.issues ?? [])
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("creating: the reminder time and the part of the day are optional", () => {
  test("without them everything is as before", () => {
    const result = create({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reminderTime).toBeUndefined();
      expect(result.data.daypart).toBeUndefined();
      expect(reminderColumns(result.data)).toEqual({ reminderTime: null, daypart: null });
    }
  });

  test("blank (what an empty field sends) or null is none", () => {
    for (const blank of ["", null]) {
      const result = create({ reminderTime: blank, daypart: blank });
      expect(result.success, String(blank)).toBe(true);
      if (result.success) {
        expect(reminderColumns(result.data)).toEqual({ reminderTime: null, daypart: null });
      }
    }
  });

  test("a time is HH:MM, 24 h, without seconds", () => {
    for (const good of ["00:00", "07:30", "22:00", "23:59"]) {
      expect(create({ reminderTime: good }).success, good).toBe(true);
    }
    for (const bad of ["7:30", "22:00:00", "24:00", "12:60", "22-00", "ocho", " 22:00", "22:0"]) {
      const result = create({ reminderTime: bad });
      expect(result.success, bad).toBe(false);
      expect(messagesOf(result, "reminderTime"), bad).toContain(REMINDER_ERRORS.timeInvalid);
    }
  });

  test("the part of the day is Mañana, Tarde or Noche (morning, afternoon, evening)", () => {
    for (const good of ["morning", "afternoon", "evening"]) {
      expect(create({ daypart: good }).success, good).toBe(true);
    }
    for (const bad of ["night", "Mañana", "noon", 1]) {
      const result = create({ daypart: bad });
      expect(result.success, String(bad)).toBe(false);
      expect(messagesOf(result, "daypart")).toContain(REMINDER_ERRORS.daypartInvalid);
    }
  });

  test("a habit to avoid takes no time, but may have a part of the day", () => {
    const withTime = create({ kind: "avoid", reminderTime: "22:00" });
    expect(withTime.success).toBe(false);
    expect(messagesOf(withTime, "reminderTime")).toEqual([REMINDER_ERRORS.timeAvoid]);
    expect(create({ kind: "avoid", daypart: "evening" }).success).toBe(true);
    expect(create({ kind: "avoid" }).success).toBe(true);
    // Positive control: the same time on a habit to keep passes.
    expect(create({ kind: "build", reminderTime: "22:00" }).success).toBe(true);
  });
});

describe("editing: missing leaves, blank or null clears", () => {
  test("missing sends no column at all", () => {
    const result = update({});
    expect(result.success).toBe(true);
    if (result.success) expect(reminderUpdateColumns(result.data)).toEqual({});
  });

  test("a value sets it; blank or null clears it", () => {
    const set = update({ reminderTime: "21:15", daypart: "evening" });
    expect(set.success && reminderUpdateColumns(set.data)).toEqual({
      reminderTime: "21:15",
      daypart: "evening",
    });
    for (const blank of ["", null]) {
      const cleared = update({ reminderTime: blank, daypart: blank });
      expect(cleared.success, String(blank)).toBe(true);
      expect(cleared.success && reminderUpdateColumns(cleared.data)).toEqual({
        reminderTime: null,
        daypart: null,
      });
    }
  });

  test("the same time and part-of-the-day rules apply", () => {
    expect(update({ reminderTime: "25:00" }).success).toBe(false);
    expect(update({ reminderTime: "22:00:00" }).success).toBe(false);
    expect(update({ daypart: "night" }).success).toBe(false);
  });
});

let serial = 0;
function habit(values: Partial<HabitItem> = {}): HabitItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Hábito ${serial}`,
    kind: "build",
    measure: "check",
    goal: 1,
    unit: null,
    step: 1,
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-09-01",
    area: null,
    quantity: 0,
    target: 1,
    hasLogs: false,
    weekDoneBefore: 0,
    weekAvailable: 7,
    streak: { unit: "days", done: 0, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
    reminderTime: null,
    daypart: null,
    ...values,
  };
}

describe("groupByDaypart", () => {
  test("with no part of the day anywhere there is no grouping: the screen stays as it was", () => {
    expect(groupByDaypart([habit(), habit(), habit()])).toBeNull();
    expect(groupByDaypart([])).toBeNull();
    // Habits from before R4 do not even have the fields.
    const old = habit() as Partial<HabitItem>;
    delete old.daypart;
    expect(groupByDaypart([old as HabitItem])).toBeNull();
  });

  test("Mañana, Tarde, Noche and «Sin franja» last, each in the order it came in", () => {
    const list = [
      habit({ name: "sin 1" }),
      habit({ name: "noche 1", daypart: "evening" }),
      habit({ name: "mañana 1", daypart: "morning" }),
      habit({ name: "tarde 1", daypart: "afternoon" }),
      habit({ name: "mañana 2", daypart: "morning" }),
      habit({ name: "sin 2" }),
    ];
    const bands = groupByDaypart(list)!;
    expect(bands.map((band) => band.label)).toEqual(["Mañana", "Tarde", "Noche", "Sin franja"]);
    expect(bands.map((band) => band.key)).toEqual(["morning", "afternoon", "evening", "none"]);
    expect(bands.map((band) => band.habits.map((item) => item.name))).toEqual([
      ["mañana 1", "mañana 2"],
      ["tarde 1"],
      ["noche 1"],
      ["sin 1", "sin 2"],
    ]);
  });

  test("a band with no habit is not listed; one habit with a part of the day is enough to group", () => {
    const bands = groupByDaypart([habit({ name: "a", daypart: "evening" }), habit({ name: "b" })])!;
    expect(bands.map((band) => band.label)).toEqual(["Noche", "Sin franja"]);
    const only = groupByDaypart([habit({ daypart: "afternoon" })])!;
    expect(only.map((band) => band.label)).toEqual(["Tarde"]);
  });

  test("every habit lands in exactly one band", () => {
    const list = [
      habit({ daypart: "morning" }),
      habit(),
      habit({ daypart: "evening" }),
      habit({ daypart: "morning" }),
    ];
    const ids = groupByDaypart(list)!.flatMap((band) => band.habits.map((item) => item.id));
    expect([...ids].sort()).toEqual(list.map((item) => item.id).sort());
  });

  test("visualOrder is the band order, or the given one when there is no grouping", () => {
    const plain = [habit({ name: "x" }), habit({ name: "y" })];
    expect(visualOrder(plain).map((item) => item.name)).toEqual(["x", "y"]);
    const grouped = [habit({ name: "sin" }), habit({ name: "mañana", daypart: "morning" })];
    expect(visualOrder(grouped).map((item) => item.name)).toEqual(["mañana", "sin"]);
  });
});

describe("timedHabitsLeft: who gets a habit_time reminder", () => {
  /** Friday 2026-10-02, 22:00 in Lima. */
  const NOW = new Date("2026-10-03T03:00:00Z");
  const names = (list: { name: string }[]) => list.map((item) => item.name);

  test("a habit with a time that is due and not met", () => {
    const list = [habit({ name: "Leer", reminderTime: "22:00" })];
    expect(timedHabitsLeft(list, NOW)).toEqual([
      { id: list[0].id, name: "Leer", reminderTime: "22:00" },
    ]);
  });

  test("a habit without a time gets none", () => {
    expect(timedHabitsLeft([habit({ name: "Sin hora", daypart: "evening" })], NOW)).toEqual([]);
  });

  test("a met habit gets none; one at part of its goal still does (a quantity)", () => {
    const list = [
      habit({ name: "hecho", reminderTime: "22:00", quantity: 1, target: 1 }),
      habit({
        name: "parcial",
        measure: "quantity",
        goal: 8,
        target: 8,
        unit: "vasos",
        quantity: 3,
        reminderTime: "22:00",
      }),
      habit({
        name: "completo",
        measure: "quantity",
        goal: 8,
        target: 8,
        unit: "vasos",
        quantity: 8,
        reminderTime: "22:00",
      }),
    ];
    expect(names(timedHabitsLeft(list, NOW))).toEqual(["parcial"]);
  });

  test("a paused habit gets none; one whose pause starts later still does", () => {
    const pause = { id: "p", startDate: "2026-10-01", endDate: "2026-10-03", reason: null };
    const list = [
      habit({ name: "en pausa", reminderTime: "22:00", pause }),
      habit({
        name: "pausa futura",
        reminderTime: "22:00",
        pause: { ...pause, startDate: "2026-10-04", endDate: "2026-10-05" },
      }),
    ];
    expect(names(timedHabitsLeft(list, NOW))).toEqual(["pausa futura"]);
  });

  test("fixed days: only the habit whose day it is (Friday)", () => {
    const list = [
      habit({ name: "viernes", reminderTime: "22:00", frequency: "weekdays", weekdays: [5] }),
      habit({ name: "lunes", reminderTime: "22:00", frequency: "weekdays", weekdays: [1] }),
    ];
    expect(names(timedHabitsLeft(list, NOW))).toEqual(["viernes"]);
  });

  test("not yet started gets none", () => {
    expect(
      timedHabitsLeft([habit({ reminderTime: "22:00", startDate: "2026-10-03" })], NOW),
    ).toEqual([]);
  });

  test("«X veces por semana» stops once the week's quota is met", () => {
    const list = [
      habit({
        name: "cumplida",
        reminderTime: "22:00",
        frequency: "weekly_count",
        weeklyTarget: 2,
        weekDoneBefore: 2,
      }),
      habit({
        name: "pendiente",
        reminderTime: "22:00",
        frequency: "weekly_count",
        weeklyTarget: 3,
        weekDoneBefore: 1,
      }),
    ];
    expect(names(timedHabitsLeft(list, NOW))).toEqual(["pendiente"]);
  });

  test("a habit to avoid never gets one, even if a row somehow carried a time", () => {
    expect(
      timedHabitsLeft([habit({ name: "No fumar", kind: "avoid", reminderTime: "22:00" })], NOW),
    ).toEqual([]);
  });

  test("the day is Lima's: 23:59 is still Friday, and the next second is Saturday", () => {
    const list = [
      habit({ name: "viernes", reminderTime: "23:30", frequency: "weekdays", weekdays: [5] }),
    ];
    expect(names(timedHabitsLeft(list, new Date("2026-10-03T04:59:59Z")))).toEqual(["viernes"]);
    expect(names(timedHabitsLeft(list, new Date("2026-10-03T05:00:00Z")))).toEqual([]);
  });
});
