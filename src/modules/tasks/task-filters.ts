// The filters of "Todas" (T2) in the URL: `?vista=todas&area=<slug>&proyecto=<id>` (the tag
// filter, `etiqueta`, is T4's). Pure and client-safe. A filter survives a reload or a shared
// link; an unknown value is ignored ("all").
import { TASKS_PATH, VIEW_PARAM } from "./routes";
import type { TaskAreaSummary, TaskItem, TaskTargets } from "./task-input";
import type { TaskFilters } from "./task-views";

export const AREA_PARAM = "area";
export const PROJECT_PARAM = "proyecto";
// ── T4 slot (Etiqueta): `TAG_PARAM = "etiqueta"`. ──

/** An area the filter offers; `archived` when it is only there because a task still shows it. */
export type AreaFilterChoice = TaskAreaSummary & { archived: boolean };

/** A project the filter offers, with its area. */
export type ProjectFilterChoice = { id: string; name: string; area: TaskAreaSummary | null };

export type FilterChoices = { areas: AreaFilterChoice[]; projects: ProjectFilterChoice[] };

/** What the URL asks for: the area by slug, the project by id. */
export type FilterParams = {
  area: string | null;
  project: string | null;
  // ── T4 slot (Etiqueta): `tag: string | null`. ──
};

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const single = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : null;

/** The filter parameters of a request's search params. */
export function parseFilterParams(
  search: Record<string, string | string[] | undefined>,
): FilterParams {
  const project = single(search[PROJECT_PARAM]);
  return {
    area: single(search[AREA_PARAM]),
    project: project !== null && UUID.test(project) ? project.toLowerCase() : null,
  };
}

/**
 * What the filters offer: every active area (in its order) plus an archived one a pending task
 * still shows; and the projects that have pending tasks (by name), only those of the chosen
 * area when there is one (a project without pending tasks would always give an empty list).
 * The project in the URL stays offered while it is open, even once its last task is done: the
 * filter doesn't vanish under the owner's hands.
 */
export function filterChoices(
  targets: TaskTargets,
  pending: readonly TaskItem[],
  areaId: string | null,
  selectedProjectId: string | null = null,
): FilterChoices {
  const areas: AreaFilterChoice[] = targets.areas.map((area) => ({ ...area, archived: false }));
  const projects = new Map<string, ProjectFilterChoice>();
  for (const task of pending) {
    if (task.area && !areas.some((area) => area.id === task.area?.id)) {
      areas.push({ ...task.area, archived: true });
    }
    if (task.project && !projects.has(task.project.id)) {
      projects.set(task.project.id, { id: task.project.id, name: task.project.name, area: task.area });
    }
  }
  const selected = targets.projects.find((project) => project.id === selectedProjectId);
  if (selected && !projects.has(selected.id)) {
    projects.set(selected.id, { id: selected.id, name: selected.name, area: selected.area });
  }
  const projectList = [...projects.values()]
    .filter((project) => areaId === null || project.area?.id === areaId)
    .sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
  return { areas, projects: projectList };
}

/**
 * The filters a request means, and what the filter keys offer: the area of the slug, then the
 * project of the id among that area's choices. Anything unknown (or a project of another area)
 * is "all".
 */
export function resolveFilters(
  params: FilterParams,
  targets: TaskTargets,
  pending: readonly TaskItem[],
): { filters: TaskFilters; choices: FilterChoices } {
  const areas = filterChoices(targets, pending, null).areas;
  const area = params.area ? areas.find((item) => item.slug === params.area) : undefined;
  const choices = filterChoices(targets, pending, area?.id ?? null, params.project);
  const project = params.project
    ? choices.projects.find((item) => item.id === params.project)
    : undefined;
  return { filters: { areaId: area?.id ?? null, projectId: project?.id ?? null }, choices };
}

/**
 * The link of "Todas" with these filters. Picking an area drops the project (it may be from
 * another area); picking a project keeps the area.
 */
export function allViewHref(params: FilterParams): string {
  const search = new URLSearchParams({ [VIEW_PARAM]: "todas" });
  if (params.area) search.set(AREA_PARAM, params.area);
  if (params.project) search.set(PROJECT_PARAM, params.project);
  // ── T4 slot (Etiqueta): `if (params.tag) search.set(TAG_PARAM, params.tag);` ──

  return `${TASKS_PATH}?${search.toString()}`;
}
