// T5: the "Tareas" section of a project, pure parts (grouping by milestone, the next-action mark,
// the next-action input).
import { describe, expect, test } from "vitest";
import { setNextActionInputSchema } from "@/modules/tasks/next-action-input";
import {
  applyNextActionChange,
  groupsByMilestone,
  milestoneGroupOf,
  NO_MILESTONE_KEY,
  sortByMilestone,
} from "@/modules/tasks/project-task-groups";
import type { TaskItem } from "@/modules/tasks/task-input";
import { groupRuns } from "@/modules/tasks/task-views";

const NOW = new Date("2026-10-02T15:00:00.000Z");
const PLANS = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Planos" };
const PAINT = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Pintura" };
const MILESTONES = [PLANS, PAINT];

let serial = 0;
function task(values: Partial<TaskItem>): TaskItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Tarea ${serial}`,
    priority: "medium",
    dueDate: null,
    doneAt: null,
    createdAt: new Date(NOW.getTime() + serial),
    lifeAreaId: null,
    projectId: "p",
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags: [],
    ...values,
  };
}

describe("grouping by milestone", () => {
  test("milestone order, then 'Sin hito' last; inside, like Todas (date, priority, creation)", () => {
    const loose = task({ title: "suelta", dueDate: "2026-10-01" });
    const paintLate = task({ title: "pintar", milestoneId: PAINT.id, dueDate: "2026-10-09" });
    const paintSoon = task({ title: "lijar", milestoneId: PAINT.id, dueDate: "2026-10-03" });
    const plansHigh = task({ title: "medir", milestoneId: PLANS.id, priority: "high" });
    const plansLow = task({ title: "dibujar", milestoneId: PLANS.id, priority: "low" });
    // A milestone the page doesn't know (added after it loaded, or deleted) goes with "Sin hito".
    const unknown = task({ title: "otro", milestoneId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    const sorted = sortByMilestone(
      [loose, paintLate, unknown, plansLow, paintSoon, plansHigh],
      MILESTONES,
    );
    expect(sorted.map((item) => item.title)).toEqual([
      "medir",
      "dibujar",
      "lijar",
      "pintar",
      "suelta",
      "otro",
    ]);
    const groups = groupRuns(sorted, milestoneGroupOf(MILESTONES));
    expect(groups.map(({ group, tasks }) => [group.label, tasks.length])).toEqual([
      ["Planos", 2],
      ["Pintura", 2],
      ["Sin hito", 2],
    ]);
    expect(groups.at(-1)?.group.key).toBe(NO_MILESTONE_KEY);
  });

  test("groups only when a pending task is in one of the project's milestones", () => {
    expect(groupsByMilestone([task({}), task({})], MILESTONES)).toBe(false);
    expect(groupsByMilestone([task({ milestoneId: PLANS.id })], [])).toBe(false);
    expect(groupsByMilestone([task({}), task({ milestoneId: PLANS.id })], MILESTONES)).toBe(true);
    expect(groupsByMilestone([], MILESTONES)).toBe(false);
  });
});

describe("the next-action mark", () => {
  test("marking one unmarks the others; unmarking touches only that one", () => {
    const a = task({ isNextAction: true });
    const b = task({});
    const c = task({});
    const marked = applyNextActionChange([a, b, c], { id: b.id, next: true });
    expect(marked.map((item) => item.isNextAction)).toEqual([false, true, false]);
    const unmarked = applyNextActionChange(marked, { id: b.id, next: false });
    expect(unmarked.map((item) => item.isNextAction)).toEqual([false, false, false]);
    // Unmarking another one leaves the marked one alone.
    expect(
      applyNextActionChange([a, b], { id: b.id, next: false }).map((item) => item.isNextAction),
    ).toEqual([true, false]);
    // Unchanged tasks keep their identity (no needless re-renders).
    expect(applyNextActionChange([a, b], { id: a.id, next: true })[0]).toBe(a);
  });

  test("input: a uuid and a boolean", () => {
    expect(setNextActionInputSchema.safeParse({ id: PLANS.id, next: true }).success).toBe(true);
    expect(setNextActionInputSchema.safeParse({ id: "x", next: true }).success).toBe(false);
    expect(setNextActionInputSchema.safeParse({ id: PLANS.id, next: "yes" }).success).toBe(false);
    expect(setNextActionInputSchema.safeParse({ id: PLANS.id }).success).toBe(false);
  });
});
