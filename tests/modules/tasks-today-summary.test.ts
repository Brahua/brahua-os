// T6: what `tasks` tells `today` (pure part): which tasks, in what order, with which label, by
// Lima's calendar day.
import { describe, expect, test } from "vitest";
import type { TaskAreaSummary } from "@/modules/tasks/task-input";
import { buildTasksTodaySummary, type TaskTodayRow } from "@/modules/tasks/today-summary";

// 2026-10-02 in Lima runs from 05:00 UTC on the 2nd to 04:59:59 UTC on the 3rd.
const LIMA_MORNING = new Date("2026-10-02T15:00:00Z");
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");

const AREA: TaskAreaSummary = {
  id: "a1",
  slug: "home",
  name: "Hogar",
  icon: "sun",
  color: "home",
};

let counter = 0;
function row(title: string, values: Partial<TaskTodayRow> = {}): TaskTodayRow {
  counter += 1;
  return {
    id: `id-${String(counter).padStart(3, "0")}`,
    title,
    priority: "medium",
    dueDate: "2026-10-02",
    dueTime: null,
    doneAt: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, counter)),
    area: null,
    project: null,
    isNextAction: false,
    ...values,
  };
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe("buildTasksTodaySummary", () => {
  test("keeps overdue and due today; drops done, future and undated", () => {
    const items = buildTasksTodaySummary(
      [
        row("hoy"),
        row("retrasada", { dueDate: "2026-09-30" }),
        row("mañana", { dueDate: "2026-10-03" }),
        row("sin fecha", { dueDate: null }),
        row("hecha", { dueDate: "2026-10-01", doneAt: LIMA_MORNING }),
      ],
      LIMA_MORNING,
    );
    expect(titles(items)).toEqual(["retrasada", "hoy"]);
    expect(items.map((item) => item.due)).toEqual([
      { kind: "overdue", days: 2, label: "Retrasada hace 2 días" },
      { kind: "today", days: 0, label: "Vence hoy" },
    ]);
  });

  test("most overdue first, then priority (Alta first), then creation, then id", () => {
    const items = buildTasksTodaySummary(
      [
        row("hoy media vieja"),
        row("hoy baja", { priority: "low" }),
        row("hoy alta", { priority: "high" }),
        row("hoy media nueva"),
        row("retrasada 1 día", { dueDate: "2026-10-01", priority: "low" }),
        row("retrasada 10 días", { dueDate: "2026-09-22", priority: "low" }),
        row("mismo instante b", { id: "z", createdAt: new Date(0) }),
        row("mismo instante a", { id: "y", createdAt: new Date(0) }),
      ],
      LIMA_MORNING,
    );
    expect(titles(items)).toEqual([
      "retrasada 10 días",
      "retrasada 1 día",
      "hoy alta",
      "mismo instante a",
      "mismo instante b",
      "hoy media vieja",
      "hoy media nueva",
      "hoy baja",
    ]);
  });

  test("the order doesn't depend on the input order", () => {
    const rows = [
      row("c", { dueDate: "2026-10-02", priority: "low" }),
      row("a", { dueDate: "2026-09-01" }),
      row("b", { dueDate: "2026-10-02", priority: "high" }),
    ];
    const forward = titles(buildTasksTodaySummary(rows, LIMA_MORNING));
    expect(forward).toEqual(["a", "b", "c"]);
    expect(titles(buildTasksTodaySummary([...rows].reverse(), LIMA_MORNING))).toEqual(forward);
  });

  test("Lima's midnight: at 23:59:59 in Lima tomorrow isn't in yet; at 00:00 it is and today is late", () => {
    const rows = [row("del 2"), row("del 3", { dueDate: "2026-10-03" })];
    // UTC already says the 3rd at 04:59:59; Lima still says the 2nd.
    const before = buildTasksTodaySummary(rows, LIMA_LAST_SECOND);
    expect(before.map((item) => [item.title, item.due.label])).toEqual([["del 2", "Vence hoy"]]);
    const after = buildTasksTodaySummary(rows, LIMA_MIDNIGHT);
    expect(after.map((item) => [item.title, item.due.label])).toEqual([
      ["del 2", "Retrasada hace 1 día"],
      ["del 3", "Vence hoy"],
    ]);
  });

  test("the DTO: only what `today` shows (no done or creation instants)", () => {
    const project = { id: "p1", name: "Cocina" };
    const [item] = buildTasksTodaySummary(
      [row("con proyecto", { area: AREA, project, isNextAction: true, priority: "high" })],
      LIMA_MORNING,
    );
    expect(item).toEqual({
      id: expect.any(String),
      title: "con proyecto",
      priority: "high",
      dueDate: "2026-10-02",
      dueTime: null,
      due: { kind: "today", days: 0, label: "Vence hoy" },
      area: AREA,
      project,
      isNextAction: true,
    });
  });

  test("empty in, empty out", () => {
    expect(buildTasksTodaySummary([], LIMA_MORNING)).toEqual([]);
  });
});
