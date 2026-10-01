// Order and grouping of the projects list (SPEC-projects "Pantallas"). Pure and client-safe.
import type { ProjectPriority, ProjectStatus } from "./project-constants";
import type { ProjectAreaSummary, ProjectSummary } from "./project-input";

/** An area chip of the list's filter. `archived`: the area is archived but still has projects. */
export type AreaFilterOption = ProjectAreaSummary & { archived: boolean };

/**
 * Options of the area filter: the active areas in their order, then any archived area that still
 * has projects (a project keeps its area when the area is archived), by name.
 */
export function areaFilterOptions(
  activeAreas: readonly ProjectAreaSummary[],
  projects: readonly ProjectSummary[],
): AreaFilterOption[] {
  const active = new Set(activeAreas.map((area) => area.id));
  const archived = new Map<string, ProjectAreaSummary>();
  for (const { area } of projects) {
    if (!active.has(area.id)) archived.set(area.id, area);
  }
  return [
    ...activeAreas.map(({ id, slug, name, icon, color }) => ({
      id,
      slug,
      name,
      icon,
      color,
      archived: false,
    })),
    ...[...archived.values()]
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((area) => ({ ...area, archived: true })),
  ];
}

/** The chip `?area=<slug>` selects, or null ("Todas") for no slug or one that matches nothing. */
export function selectedAreaFilter(
  options: readonly AreaFilterOption[],
  slug: string | string[] | undefined,
): AreaFilterOption | null {
  if (typeof slug !== "string") return null;
  return options.find((option) => option.slug === slug) ?? null;
}

/** Groups of the main view, in this order. */
export const LIST_GROUPS = [
  "active",
  "maintenance",
  "paused",
  "idea",
] as const satisfies readonly ProjectStatus[];

/** Finished projects: out of the main view, in the folded "Historial" section. */
export const HISTORY_GROUPS = ["done", "canceled"] as const satisfies readonly ProjectStatus[];

const PRIORITY_RANK: Record<ProjectPriority, number> = { high: 0, medium: 1, low: 2 };

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Priority (high first), then due date (closest first, none last), then name (Spanish
 * alphabetical order, ignoring case and accents), then id so equal projects keep a stable order.
 */
export function compareProjects(
  a: Pick<ProjectSummary, "id" | "name" | "priority" | "dueDate">,
  b: Pick<ProjectSummary, "id" | "name" | "priority" | "dueDate">,
): number {
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    // YYYY-MM-DD compares as text.
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export type ProjectGroup<S extends ProjectStatus = ProjectStatus> = {
  status: S;
  projects: ProjectSummary[];
};

export type GroupedProjects = {
  /** Non-empty groups of the main view, in LIST_GROUPS order. */
  groups: ProjectGroup<(typeof LIST_GROUPS)[number]>[];
  /** Non-empty history groups (Terminado, Cancelado). */
  history: ProjectGroup<(typeof HISTORY_GROUPS)[number]>[];
  /** Projects in the history, for its counter. */
  historyCount: number;
};

/** Sorts and splits the projects into the main groups and the history. Empty groups are left out. */
export function groupProjects(projects: readonly ProjectSummary[]): GroupedProjects {
  const sorted = [...projects].sort(compareProjects);
  const of = <S extends ProjectStatus>(status: S): ProjectGroup<S> => ({
    status,
    projects: sorted.filter((project) => project.status === status),
  });
  const groups = LIST_GROUPS.map(of).filter((group) => group.projects.length > 0);
  const history = HISTORY_GROUPS.map(of).filter((group) => group.projects.length > 0);
  return {
    groups,
    history,
    historyCount: history.reduce((total, group) => total + group.projects.length, 0),
  };
}
