// T2: the views of /tasks as pure functions (which tasks, in what order, grouped how), by
// Lima's calendar day, and the "Todas" filters in the URL.
import { describe, expect, test } from "vitest";
import {
  allViewHref,
  filterChoices,
  parseFilterParams,
  resolveFilters,
} from "@/modules/tasks/task-filters";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import {
  addDays,
  compareByDoneDesc,
  compareByDue,
  doneLabel,
  groupRuns,
  isDueByToday,
  isPendingMatching,
  isRecentlyDone,
  isUpcoming,
  matchesFilters,
  NO_FILTERS,
  upcomingDayLabel,
  upcomingGroup,
} from "@/modules/tasks/task-views";

// Friday 2026-10-02 in Lima runs from 05:00 UTC on the 2nd to 04:59:59 UTC on the 3rd.
const LIMA_MORNING = new Date("2026-10-02T15:00:00Z");
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");

const HOME = { id: "a-home", slug: "home", name: "Hogar", icon: "house", color: "home" } as const;
const WORK = {
  id: "a-work",
  slug: "work",
  name: "Trabajo",
  icon: "briefcase",
  color: "work",
} as const;
const OLD = { id: "a-old", slug: "old", name: "Viejo", icon: "house", color: "home" } as const;

let serial = 0;
function task(values: Partial<TaskItem> = {}): TaskItem {
  serial += 1;
  return {
    id: `t-${String(serial).padStart(3, "0")}`,
    title: `Tarea ${serial}`,
    priority: "medium",
    dueDate: null,
    doneAt: null,
    createdAt: new Date("2026-09-01T12:00:00Z"),
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

describe("Hoy", () => {
  test("overdue and due today, pending; not tomorrow, not undated, not done", () => {
    expect(isDueByToday(task({ dueDate: "2026-09-20" }), LIMA_MORNING)).toBe(true);
    expect(isDueByToday(task({ dueDate: "2026-10-02" }), LIMA_MORNING)).toBe(true);
    expect(isDueByToday(task({ dueDate: "2026-10-03" }), LIMA_MORNING)).toBe(false);
    expect(isDueByToday(task(), LIMA_MORNING)).toBe(false);
    expect(isDueByToday(task({ dueDate: "2026-10-01", doneAt: LIMA_MORNING }), LIMA_MORNING)).toBe(
      false,
    );
  });

  test("around Lima's midnight: tomorrow joins Hoy at 00:00 in Lima, not at 00:00 UTC", () => {
    // 04:59:59 UTC on the 3rd is still the 2nd in Lima.
    expect(isDueByToday(task({ dueDate: "2026-10-03" }), LIMA_LAST_SECOND)).toBe(false);
    expect(isDueByToday(task({ dueDate: "2026-10-03" }), LIMA_MIDNIGHT)).toBe(true);
  });
});

describe("Próximas", () => {
  test("tomorrow up to 7 days ahead; never today, overdue, undated or done", () => {
    const upcoming = (dueDate: string | null, doneAt: Date | null = null) =>
      isUpcoming(task({ dueDate, doneAt }), LIMA_MORNING);
    expect(upcoming("2026-10-02")).toBe(false);
    expect(upcoming("2026-10-01")).toBe(false);
    expect(upcoming("2026-10-03")).toBe(true);
    expect(upcoming("2026-10-09")).toBe(true);
    expect(upcoming("2026-10-10")).toBe(false);
    expect(upcoming(null)).toBe(false);
    expect(upcoming("2026-10-04", LIMA_MORNING)).toBe(false);
  });

  test("the window moves at Lima's midnight", () => {
    expect(isUpcoming(task({ dueDate: "2026-10-10" }), LIMA_LAST_SECOND)).toBe(false);
    expect(isUpcoming(task({ dueDate: "2026-10-10" }), LIMA_MIDNIGHT)).toBe(true);
    expect(isUpcoming(task({ dueDate: "2026-10-03" }), LIMA_MIDNIGHT)).toBe(false);
  });

  test("day headings: Mañana, then the weekday and date (Lima)", () => {
    expect(upcomingDayLabel("2026-10-03", LIMA_MORNING)).toBe("Mañana");
    expect(upcomingDayLabel("2026-10-04", LIMA_MORNING)).toBe("Domingo 4 de octubre");
    expect(upcomingDayLabel("2026-10-08", LIMA_MORNING)).toBe("Jueves 8 de octubre");
    // At 23:59:59 in Lima the 3rd is still tomorrow; a second later it is today, the 4th is.
    expect(upcomingDayLabel("2026-10-03", LIMA_LAST_SECOND)).toBe("Mañana");
    expect(upcomingDayLabel("2026-10-04", LIMA_MIDNIGHT)).toBe("Mañana");
    // Across a month and a year.
    expect(upcomingDayLabel("2027-01-02", new Date("2026-12-31T15:00:00Z"))).toBe(
      "Sábado 2 de enero",
    );
  });

  test("groups: one run per day, in the list's order", () => {
    const a = task({ dueDate: "2026-10-03" });
    const b = task({ dueDate: "2026-10-03" });
    const c = task({ dueDate: "2026-10-05" });
    const runs = groupRuns([a, b, c], (item) => upcomingGroup(item, LIMA_MORNING));
    expect(runs.map((run) => [run.group.label, run.tasks.map((item) => item.id)])).toEqual([
      ["Mañana", [a.id, b.id]],
      ["Lunes 5 de octubre", [c.id]],
    ]);
    expect(groupRuns([], (item: TaskItem) => upcomingGroup(item, LIMA_MORNING))).toEqual([]);
  });
});

describe("Hechas", () => {
  test("done from Lima's midnight 30 days ago on (Lima days, like the labels); pending never", () => {
    expect(isRecentlyDone(task({ doneAt: LIMA_MORNING }), LIMA_MORNING)).toBe(true);
    // 00:00 on Sep 2 in Lima is 05:00 UTC: in; a second earlier (Sep 1 in Lima): out.
    expect(isRecentlyDone(task({ doneAt: new Date("2026-09-02T05:00:00Z") }), LIMA_MORNING)).toBe(
      true,
    );
    expect(isRecentlyDone(task({ doneAt: new Date("2026-09-02T04:59:59Z") }), LIMA_MORNING)).toBe(
      false,
    );
    // At Lima's midnight the window moves a day.
    expect(isRecentlyDone(task({ doneAt: new Date("2026-09-02T05:00:00Z") }), LIMA_MIDNIGHT)).toBe(
      false,
    );
    expect(isRecentlyDone(task(), LIMA_MORNING)).toBe(false);
  });

  test("labels by Lima's day: hoy, ayer, then the date", () => {
    expect(doneLabel(new Date("2026-10-02T05:00:00Z"), LIMA_MORNING)).toBe("Hecha hoy");
    // 23:30 on the 1st in Lima is already the 2nd in UTC.
    expect(doneLabel(new Date("2026-10-02T04:30:00Z"), LIMA_MORNING)).toBe("Hecha ayer");
    expect(doneLabel(new Date("2026-09-28T15:00:00Z"), LIMA_MORNING)).toBe("Hecha el 28 set. 2026");
  });

  test("the most recently done first", () => {
    const early = task({ doneAt: new Date("2026-10-01T10:00:00Z") });
    const late = task({ doneAt: new Date("2026-10-02T10:00:00Z") });
    expect([early, late].sort(compareByDoneDesc).map((item) => item.id)).toEqual([
      late.id,
      early.id,
    ]);
  });
});

describe("order (Hoy, Próximas, Todas)", () => {
  test("by due date (oldest first, undated last), then priority, then creation, then id", () => {
    const undated = task({ priority: "high" });
    const late = task({ dueDate: "2026-09-20", priority: "low" });
    const todayLow = task({ dueDate: "2026-10-02", priority: "low" });
    const todayHigh = task({ dueDate: "2026-10-02", priority: "high" });
    const todayMediumOld = task({
      dueDate: "2026-10-02",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    const todayMediumNew = task({
      dueDate: "2026-10-02",
      createdAt: new Date("2026-09-30T00:00:00Z"),
    });
    const shuffled = [todayMediumNew, undated, todayLow, late, todayHigh, todayMediumOld];
    expect([...shuffled].sort(compareByDue).map((item) => item.id)).toEqual([
      late.id,
      todayHigh.id,
      todayMediumOld.id,
      todayMediumNew.id,
      todayLow.id,
      undated.id,
    ]);
    // Same everything: the id decides (stable between loads).
    const twinA = task({ id: "t-a" });
    const twinB = task({ id: "t-b" });
    expect([twinB, twinA].sort(compareByDue).map((item) => item.id)).toEqual(["t-a", "t-b"]);
  });
});

describe("Todas: filters", () => {
  const PROJECT = { id: "p-1", name: "Cocina", status: "active" } as const;
  const inHome = task({ lifeAreaId: HOME.id, area: HOME });
  const inProject = task({ projectId: PROJECT.id, project: PROJECT, area: HOME });
  const inWork = task({ lifeAreaId: WORK.id, area: WORK });
  const inbox = task();

  test("by area (its own or its project's), by project, both; pending only", () => {
    const ids = (filters: Parameters<typeof matchesFilters>[1]) =>
      [inHome, inProject, inWork, inbox]
        .filter((item) => matchesFilters(item, filters))
        .map((item) => item.id);
    expect(ids(NO_FILTERS)).toEqual([inHome.id, inProject.id, inWork.id, inbox.id]);
    expect(ids({ areaId: HOME.id, projectId: null, tagId: null })).toEqual([
      inHome.id,
      inProject.id,
    ]);
    expect(ids({ areaId: null, projectId: PROJECT.id, tagId: null })).toEqual([inProject.id]);
    expect(ids({ areaId: WORK.id, projectId: PROJECT.id, tagId: null })).toEqual([]);
    expect(isPendingMatching({ ...inHome, doneAt: LIMA_MORNING }, NO_FILTERS)).toBe(false);
  });

  const TARGETS: TaskTargets = {
    areas: [HOME, WORK],
    projects: [
      { ...PROJECT, area: HOME },
      { id: "p-2", name: "Ático", status: "active", area: WORK },
    ],
  };
  const archived = task({ lifeAreaId: OLD.id, area: OLD });
  const pending = [inHome, inProject, inWork, inbox, archived];

  test("choices: active areas in order plus archived ones still shown; projects with tasks", () => {
    const choices = filterChoices(TARGETS, pending, null);
    expect(choices.areas.map((area) => [area.slug, area.archived])).toEqual([
      ["home", false],
      ["work", false],
      ["old", true],
    ]);
    // "Ático" has no pending task: not offered.
    expect(choices.projects.map((project) => project.name)).toEqual(["Cocina"]);
    expect(filterChoices(TARGETS, pending, WORK.id).projects).toEqual([]);
    // Unless it is the one in the URL (its last task was just done): it stays.
    expect(filterChoices(TARGETS, pending, null, "p-2").projects.map((p) => p.name)).toEqual([
      "Ático",
      "Cocina",
    ]);
  });

  test("the URL: area by slug, project by id; unknown or of another area means all", () => {
    const none = { area: null, project: null, tagId: null };
    expect(parseFilterParams({})).toEqual(none);
    expect(parseFilterParams({ area: "home", proyecto: "not-a-uuid" })).toEqual({
      ...none,
      area: "home",
    });
    expect(parseFilterParams({ area: ["home", "work"] })).toEqual(none);
    expect(resolveFilters({ ...none, area: "home" }, TARGETS, pending).filters).toEqual({
      ...NO_FILTERS,
      areaId: HOME.id,
    });
    expect(resolveFilters({ ...none, area: "nada" }, TARGETS, pending).filters).toEqual(NO_FILTERS);
    expect(resolveFilters({ ...none, project: "p-1" }, TARGETS, pending).filters).toEqual({
      ...NO_FILTERS,
      projectId: "p-1",
    });
    // Cocina is in Hogar: with Trabajo chosen, the project filter doesn't apply.
    expect(
      resolveFilters({ ...none, area: "work", project: "p-1" }, TARGETS, pending).filters,
    ).toEqual({ ...NO_FILTERS, areaId: WORK.id });
  });

  test("links keep the view and the filters", () => {
    expect(allViewHref({ area: null, project: null, tagId: null })).toBe("/tasks?vista=todas");
    expect(allViewHref({ area: "home", project: "p-1", tagId: null })).toBe(
      "/tasks?vista=todas&area=home&proyecto=p-1",
    );
  });
});

test("addDays across months and years", () => {
  expect(addDays("2026-10-02", 7)).toBe("2026-10-09");
  expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
});
