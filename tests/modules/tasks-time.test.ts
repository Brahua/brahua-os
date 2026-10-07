// polish → task-time, pure parts: the HH:MM format, the Zod schemas (a time needs a day), and the
// order (within a day, the ones with a time first, by time; the day, and so the overdue order,
// always decides before the hour).
import { describe, expect, test } from "vitest";
import {
  createTaskInputSchema,
  editTaskInputSchema,
  TASK_ERRORS,
  type TaskItem,
} from "@/modules/tasks/task-input";
import { sortByMilestone } from "@/modules/tasks/project-task-groups";
import { applyTaskListChange } from "@/modules/tasks/task-list-optimistic";
import {
  compareDueTime,
  formatDueTime,
  isDueTime,
  normalizeDueTime,
} from "@/modules/tasks/task-time";
import { compareByDue } from "@/modules/tasks/task-views";
import { buildTasksTodaySummary, type TaskTodayRow } from "@/modules/tasks/today-summary";

const ID = "00000000-0000-4000-8000-000000000001";

describe("the format", () => {
  test.each(["00:00", "09:05", "10:00", "23:59"])("%s is a time", (value) => {
    expect(isDueTime(value)).toBe(true);
    expect(formatDueTime(value)).toBe(value);
  });

  test.each(["24:00", "25:00", "10:60", "9:05", "10:0", "10:00:00", "10", "", "ab:cd", " 10:00"])(
    "%j is not",
    (value) => {
      expect(isDueTime(value)).toBe(false);
    },
  );

  test("Postgres' time reads as HH:MM; anything else as none", () => {
    expect(normalizeDueTime("10:00:00")).toBe("10:00");
    expect(normalizeDueTime("07:05:00.000")).toBe("07:05");
    expect(normalizeDueTime("23:59")).toBe("23:59");
    expect(normalizeDueTime(null)).toBeNull();
    expect(normalizeDueTime(undefined)).toBeNull();
    expect(normalizeDueTime("24:00:00")).toBeNull();
    expect(normalizeDueTime("nope")).toBeNull();
  });

  test("with a time first, by time; without, last; equal is 0", () => {
    expect(["15:00", null, "09:00", "09:00"].sort(compareDueTime)).toEqual([
      "09:00",
      "09:00",
      "15:00",
      null,
    ]);
    expect(compareDueTime(null, null)).toBe(0);
    expect(compareDueTime("08:00", "08:00")).toBe(0);
    expect(compareDueTime("08:00", null)).toBeLessThan(0);
    expect(compareDueTime(null, "08:00")).toBeGreaterThan(0);
  });
});

describe("createTaskInputSchema", () => {
  const parse = (input: Record<string, unknown>) => createTaskInputSchema.safeParse(input);

  test("a time with a day passes; '' and missing are none", () => {
    expect(parse({ title: "x", dueDate: "2026-10-05", dueTime: "10:00" })).toMatchObject({
      success: true,
      data: { dueDate: "2026-10-05", dueTime: "10:00" },
    });
    expect(parse({ title: "x", dueDate: "2026-10-05", dueTime: "" })).toMatchObject({
      success: true,
      data: { dueTime: null },
    });
    const missing = parse({ title: "x", dueDate: "2026-10-05" });
    expect(missing.success && missing.data.dueTime).toBeUndefined();
  });

  test("a time without a day is refused, on the time", () => {
    for (const input of [
      { title: "x", dueTime: "10:00" },
      { title: "x", dueDate: null, dueTime: "10:00" },
      { title: "x", dueDate: "", dueTime: "10:00" },
    ]) {
      const result = parse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ path: ["dueTime"], message: TASK_ERRORS.timeWithoutDate }),
      ]);
    }
  });

  test.each(["24:00", "10:60", "9:00", "10:00:00", 1000, true])("%j is not a valid time", (bad) => {
    const result = parse({ title: "x", dueDate: "2026-10-05", dueTime: bad });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["dueTime"] });
  });
});

describe("editTaskInputSchema", () => {
  const parse = (input: Record<string, unknown>) =>
    editTaskInputSchema.safeParse({ id: ID, ...input });

  test("a time alone is allowed here (the stored day counts, the data layer checks it)", () => {
    expect(parse({ dueTime: "10:00" })).toMatchObject({
      success: true,
      data: { dueTime: "10:00" },
    });
    expect(parse({ dueTime: null })).toMatchObject({ success: true, data: { dueTime: null } });
    expect(parse({ dueTime: "" })).toMatchObject({ success: true, data: { dueTime: null } });
    const none = parse({ title: "otro" });
    expect(none.success && none.data.dueTime).toBeUndefined();
  });

  test("a day and a time together; clearing the day with a time is refused", () => {
    expect(parse({ dueDate: "2026-10-05", dueTime: "10:00" }).success).toBe(true);
    expect(parse({ dueDate: null }).success).toBe(true);
    expect(parse({ dueDate: null, dueTime: null }).success).toBe(true);
    const refused = parse({ dueDate: null, dueTime: "10:00" });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({
      path: ["dueTime"],
      message: TASK_ERRORS.timeWithoutDate,
    });
    expect(parse({ dueTime: "99:99" }).success).toBe(false);
  });
});

const NOW = new Date("2026-10-02T15:00:00Z");

function item(title: string, values: Partial<TaskItem> = {}): TaskItem {
  return {
    id: title,
    title,
    priority: "medium",
    dueDate: "2026-10-02",
    dueTime: null,
    doneAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    lifeAreaId: null,
    projectId: null,
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags: [],
    ...values,
  };
}

describe("compareByDue", () => {
  const titles = (list: TaskItem[]) => [...list].sort(compareByDue).map((task) => task.title);

  test("within a day: with a time first (by time), then without; priority only breaks ties", () => {
    expect(
      titles([
        item("sin hora alta", { priority: "high" }),
        item("15:00", { dueTime: "15:00" }),
        item("09:00 baja", { dueTime: "09:00", priority: "low" }),
        item("09:00 alta", { dueTime: "09:00", priority: "high" }),
        item("sin hora"),
      ]),
    ).toEqual(["09:00 alta", "09:00 baja", "15:00", "sin hora alta", "sin hora"]);
  });

  test("the day decides before the hour: an earlier day without a time beats a later day with one", () => {
    expect(
      titles([
        item("hoy 08:00", { dueTime: "08:00" }),
        item("ayer sin hora", { dueDate: "2026-10-01" }),
        item("mañana 07:00", { dueDate: "2026-10-03", dueTime: "07:00" }),
        item("anteayer 23:00", { dueDate: "2026-09-30", dueTime: "23:00" }),
      ]),
    ).toEqual(["anteayer 23:00", "ayer sin hora", "hoy 08:00", "mañana 07:00"]);
  });

  test("undated tasks stay last, with or without a time (a time needs a day, so none)", () => {
    expect(
      titles([item("sin fecha", { dueDate: null }), item("hoy", { dueTime: "23:59" })]),
    ).toEqual(["hoy", "sin fecha"]);
  });

  test("Próximas by day: each day keeps its timed tasks first", () => {
    expect(
      titles([
        item("jue sin hora", { dueDate: "2026-10-08" }),
        item("mañana sin hora", { dueDate: "2026-10-03" }),
        item("jue 08:00", { dueDate: "2026-10-08", dueTime: "08:00" }),
        item("mañana 12:00", { dueDate: "2026-10-03", dueTime: "12:00" }),
      ]),
    ).toEqual(["mañana 12:00", "mañana sin hora", "jue 08:00", "jue sin hora"]);
  });

  test("a reschedule to no day clears the time (no day, no time)", () => {
    const list = [item("a", { dueTime: "09:00" })];
    const [moved] = applyTaskListChange(list, { type: "reschedule", id: "a", dueDate: null });
    expect(moved).toMatchObject({ dueDate: null, dueTime: null });
  });

  test("a reschedule keeps the time and places the row by day, then time", () => {
    const list = [
      item("a", { dueTime: "09:00" }),
      item("b", { dueDate: "2026-10-03", dueTime: "08:00" }),
      item("c", { dueDate: "2026-10-03" }),
    ];
    const moved = applyTaskListChange(list, { type: "reschedule", id: "a", dueDate: "2026-10-03" });
    expect(moved.map((task) => task.title)).toEqual(["b", "a", "c"]);
    expect(moved.find((task) => task.title === "a")?.dueTime).toBe("09:00");
  });
});

describe("project tasks", () => {
  test("a project's pending tasks in a milestone order by day, then time", () => {
    const milestone = { id: "m1", title: "Planos" };
    const list = [
      item("sin hora", { milestoneId: "m1" }),
      item("13:00", { milestoneId: "m1", dueTime: "13:00" }),
      item("07:30", { milestoneId: "m1", dueTime: "07:30" }),
      item("otro hito 06:00", { milestoneId: "m2", dueTime: "06:00" }),
    ];
    expect(sortByMilestone(list, [milestone]).map((task) => task.title)).toEqual([
      "07:30",
      "13:00",
      "sin hora",
      "otro hito 06:00",
    ]);
  });
});

describe("buildTasksTodaySummary", () => {
  function row(title: string, values: Partial<TaskTodayRow> = {}): TaskTodayRow {
    return {
      id: title,
      title,
      priority: "medium",
      dueDate: "2026-10-02",
      dueTime: null,
      doneAt: null,
      createdAt: new Date("2026-09-01T00:00:00Z"),
      area: null,
      project: null,
      isNextAction: false,
      ...values,
    };
  }

  test("overdue by days first; within a day, with a time by time, then the rest; the DTO carries it", () => {
    const items = buildTasksTodaySummary(
      [
        row("hoy sin hora", { priority: "high" }),
        row("hoy 15:00", { dueTime: "15:00" }),
        row("hoy 09:00", { dueTime: "09:00" }),
        row("ayer sin hora", { dueDate: "2026-10-01" }),
        row("ayer 22:00", { dueDate: "2026-10-01", dueTime: "22:00" }),
        row("anteayer", { dueDate: "2026-09-30" }),
        row("mañana 07:00", { dueDate: "2026-10-03", dueTime: "07:00" }),
      ],
      NOW,
    );
    expect(items.map((task) => task.title)).toEqual([
      "anteayer",
      "ayer 22:00",
      "ayer sin hora",
      "hoy 09:00",
      "hoy 15:00",
      "hoy sin hora",
    ]);
    expect(items.map((task) => task.dueTime)).toEqual([
      null,
      "22:00",
      null,
      "09:00",
      "15:00",
      null,
    ]);
  });

  test("the Lima midnight boundary: 00:00 today is due today at 23:59, overdue a minute later", () => {
    const rows = [row("medianoche", { dueTime: "00:00" })];
    const lastMinute = buildTasksTodaySummary(rows, new Date("2026-10-03T04:59:00Z"));
    expect(lastMinute[0]).toMatchObject({ dueTime: "00:00", due: { kind: "today" } });
    // 2026-10-03T05:00Z is Lima's midnight: the 2nd is now yesterday.
    const afterMidnight = buildTasksTodaySummary(rows, new Date("2026-10-03T05:00:00Z"));
    expect(afterMidnight[0].due).toMatchObject({ kind: "overdue", label: "Retrasada hace 1 día" });
  });
});
