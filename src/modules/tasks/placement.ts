// Where a task goes, as one picker value (SPEC-tasks: area or project, or nothing = inbox).
// Pure and client-safe: the capture sheet, the inbox's "Clasificar" and the detail share it.
import type { TaskAreaSummary, TaskItem, TaskPlacement, TaskTargets } from "./task-input";
import { TASKS_COPY } from "./tasks-copy";

/** "" (inbox), `area:<id>` or `project:<id>`. */
export type PlacementValue = string;

export const INBOX_VALUE = "";

export function placementValue(task: Pick<TaskItem, "lifeAreaId" | "projectId">): PlacementValue {
  if (task.projectId) return `project:${task.projectId}`;
  if (task.lifeAreaId) return `area:${task.lifeAreaId}`;
  return INBOX_VALUE;
}

/**
 * The placement a value means. Staying in the same project keeps the task's milestone (the
 * picker doesn't show milestones; T2 adds them); anything else drops it.
 */
export function toPlacement(
  value: PlacementValue,
  current?: Pick<TaskItem, "projectId" | "milestoneId"> | null,
): TaskPlacement {
  const [kind, id] = value.split(":");
  if (kind === "project" && id) {
    const milestoneId = current?.projectId === id ? current.milestoneId : null;
    return { lifeAreaId: null, projectId: id, milestoneId };
  }
  if (kind === "area" && id) return { lifeAreaId: id, projectId: null, milestoneId: null };
  return { lifeAreaId: null, projectId: null, milestoneId: null };
}

export type PlacementOption = { value: PlacementValue; label: string };

/**
 * The picker's options: the active areas (in their order) and the open projects (by name, with
 * their area). The task's current area or project stays listed even if it is archived or closed
 * since, so the picker shows where it is.
 */
export function placementOptions(
  targets: TaskTargets | null,
  current?: Pick<TaskItem, "lifeAreaId" | "projectId" | "area" | "project"> | null,
): { areas: PlacementOption[]; projects: PlacementOption[] } {
  const areas: PlacementOption[] = (targets?.areas ?? []).map((area) => ({
    value: `area:${area.id}`,
    label: area.name,
  }));
  const projects: PlacementOption[] = (targets?.projects ?? []).map((project) => ({
    value: `project:${project.id}`,
    label: TASKS_COPY.placementProject(project.name, project.area.name),
  }));
  if (current?.lifeAreaId && current.area && !areas.some((o) => o.value === `area:${current.lifeAreaId}`)) {
    areas.unshift({
      value: `area:${current.lifeAreaId}`,
      label: TASKS_COPY.placementArchived(current.area.name),
    });
  }
  if (
    current?.projectId &&
    current.project &&
    !projects.some((o) => o.value === `project:${current.projectId}`)
  ) {
    projects.unshift({
      value: `project:${current.projectId}`,
      label: TASKS_COPY.placementClosed(current.project.name),
    });
  }
  return { areas, projects };
}

/** The name of where a value points (for "Tarea agregada a «Salud»."), or null for the inbox. */
export function placementName(targets: TaskTargets | null, value: PlacementValue): string | null {
  const { lifeAreaId, projectId } = toPlacement(value);
  if (projectId) return targets?.projects.find((p) => p.id === projectId)?.name ?? null;
  if (lifeAreaId) return targets?.areas.find((a) => a.id === lifeAreaId)?.name ?? null;
  return null;
}

/**
 * How a task looks once moved to `value` (for the optimistic view): the placement fields plus the
 * area and project it shows. Staying where it is keeps what it shows (an archived area stays).
 */
export function placementPatch(
  targets: TaskTargets | null,
  value: PlacementValue,
  current: Pick<TaskItem, "lifeAreaId" | "projectId" | "milestoneId" | "area" | "project">,
): Pick<TaskItem, "lifeAreaId" | "projectId" | "milestoneId" | "area" | "project"> {
  const next = toPlacement(value, current);
  if (next.projectId !== null && next.projectId === current.projectId) {
    return { ...next, area: current.area, project: current.project };
  }
  if (next.lifeAreaId !== null && next.lifeAreaId === current.lifeAreaId) {
    return { ...next, area: current.area, project: null };
  }
  const project = next.projectId ? targets?.projects.find((p) => p.id === next.projectId) : null;
  return {
    ...next,
    area: placementArea(targets, value),
    project: project ? { id: project.id, name: project.name, status: project.status } : null,
  };
}

/** The area a value shows (its own, or the project's), for an optimistic row. */
export function placementArea(
  targets: TaskTargets | null,
  value: PlacementValue,
): TaskAreaSummary | null {
  const { lifeAreaId, projectId } = toPlacement(value);
  if (projectId) return targets?.projects.find((p) => p.id === projectId)?.area ?? null;
  if (lifeAreaId) return targets?.areas.find((a) => a.id === lifeAreaId) ?? null;
  return null;
}
