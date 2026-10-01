import { describe, expect, test } from "vitest";
import type { ProjectAreaSummary, ProjectSummary } from "@/modules/projects/project-input";
import {
  areaFilterOptions,
  compareProjects,
  groupProjects,
  selectedAreaFilter,
} from "@/modules/projects/project-list";

const HOME: ProjectAreaSummary = {
  id: "a-home",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
};
const WORK: ProjectAreaSummary = {
  id: "a-work",
  slug: "work",
  name: "Trabajo",
  icon: "briefcase",
  color: "work",
};
const OLD: ProjectAreaSummary = {
  id: "a-old",
  slug: "old",
  name: "Antigua",
  icon: "star",
  color: "travel",
};

let serial = 0;
function project(values: Partial<ProjectSummary>): ProjectSummary {
  serial += 1;
  return {
    id: `p${String(serial).padStart(3, "0")}`,
    name: `Proyecto ${serial}`,
    objective: null,
    status: "active",
    priority: "medium",
    dueDate: null,
    area: HOME,
    ...values,
  };
}

const names = (projects: ProjectSummary[]) => projects.map((item) => item.name);

describe("compareProjects", () => {
  test("priority first: high, medium, low", () => {
    const list = [
      project({ name: "Baja", priority: "low" }),
      project({ name: "Alta", priority: "high" }),
      project({ name: "Media", priority: "medium" }),
    ];
    expect(names(list.sort(compareProjects))).toEqual(["Alta", "Media", "Baja"]);
  });

  test("then the closest due date, with no date last", () => {
    const list = [
      project({ name: "Sin fecha" }),
      project({ name: "Diciembre", dueDate: "2026-12-01" }),
      project({ name: "Octubre", dueDate: "2026-10-05" }),
      project({ name: "Vencido", dueDate: "2026-09-01" }),
    ];
    expect(names(list.sort(compareProjects))).toEqual([
      "Vencido",
      "Octubre",
      "Diciembre",
      "Sin fecha",
    ]);
  });

  test("a higher priority wins over a closer date", () => {
    const list = [
      project({ name: "Media pronto", dueDate: "2026-10-02" }),
      project({ name: "Alta sin fecha", priority: "high" }),
    ];
    expect(names(list.sort(compareProjects))).toEqual(["Alta sin fecha", "Media pronto"]);
  });

  test("then the name, in Spanish order, ignoring case and accents", () => {
    const list = [
      project({ name: "zanahoria" }),
      project({ name: "Ñandú" }),
      project({ name: "Árbol" }),
      project({ name: "nube" }),
      project({ name: "Mudanza 10" }),
      project({ name: "Mudanza 9" }),
    ];
    expect(names(list.sort(compareProjects))).toEqual([
      "Árbol",
      "Mudanza 9",
      "Mudanza 10",
      "nube",
      "Ñandú",
      "zanahoria",
    ]);
  });

  test("equal projects keep a stable order by id", () => {
    const a = project({ id: "b", name: "Igual" });
    const b = project({ id: "a", name: "Igual" });
    expect([a, b].sort(compareProjects).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("groupProjects", () => {
  test("main groups in order Activo, Mantenimiento, Pausado, Idea; empty ones left out", () => {
    const { groups, history, historyCount } = groupProjects([
      project({ name: "I", status: "idea" }),
      project({ name: "P", status: "paused" }),
      project({ name: "A", status: "active" }),
    ]);
    expect(groups.map((group) => group.status)).toEqual(["active", "paused", "idea"]);
    expect(history).toEqual([]);
    expect(historyCount).toBe(0);
  });

  test("every status in its place, sorted inside each group", () => {
    const { groups, history, historyCount } = groupProjects([
      project({ name: "Cancelado", status: "canceled" }),
      project({ name: "Hecho B", status: "done" }),
      project({ name: "Hecho A", status: "done" }),
      project({ name: "Mantener", status: "maintenance" }),
      project({ name: "Activo bajo", status: "active", priority: "low" }),
      project({ name: "Activo alto", status: "active", priority: "high" }),
      project({ name: "Idea", status: "idea" }),
      project({ name: "Pausado", status: "paused" }),
    ]);
    expect(groups.map((group) => [group.status, names(group.projects)])).toEqual([
      ["active", ["Activo alto", "Activo bajo"]],
      ["maintenance", ["Mantener"]],
      ["paused", ["Pausado"]],
      ["idea", ["Idea"]],
    ]);
    expect(history.map((group) => [group.status, names(group.projects)])).toEqual([
      ["done", ["Hecho A", "Hecho B"]],
      ["canceled", ["Cancelado"]],
    ]);
    expect(historyCount).toBe(3);
  });

  test("an empty list has no groups", () => {
    expect(groupProjects([])).toEqual({ groups: [], history: [], historyCount: 0 });
  });
});

describe("area filter", () => {
  test("active areas in their order, then archived areas that still have projects", () => {
    const options = areaFilterOptions(
      [HOME, WORK],
      [project({ area: OLD }), project({ area: HOME }), project({ area: OLD })],
    );
    expect(options.map((option) => [option.slug, option.archived])).toEqual([
      ["home", false],
      ["work", false],
      ["old", true],
    ]);
  });

  test("an archived area without projects is not offered", () => {
    expect(areaFilterOptions([HOME], []).map((option) => option.slug)).toEqual(["home"]);
  });

  test("?area=<slug> picks its chip; none, an unknown slug or a repeated param mean Todas", () => {
    const options = areaFilterOptions([HOME, WORK], []);
    expect(selectedAreaFilter(options, "work")?.id).toBe("a-work");
    expect(selectedAreaFilter(options, undefined)).toBeNull();
    expect(selectedAreaFilter(options, "nope")).toBeNull();
    expect(selectedAreaFilter(options, ["work", "home"])).toBeNull();
  });
});
