// Validation and client types of `tasks` (SPEC-tasks "Comandos y estructura"). Client-safe: the
// server actions are the authority, and the forms run the same schemas first so errors show
// without a round trip.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system/areas";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import type { ProjectStatus } from "@/modules/projects/project-constants";
import { optionalRecurrenceSchema } from "./recurrence-input";
import {
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
  type RecurrenceKind,
  type TaskPriority,
} from "./task-constants";
import { taskTagsSchema } from "./task-tags";
import { DUE_TIME_PATTERN } from "./task-time";

export { TASK_PRIORITIES, TASK_TITLE_MAX_LENGTH, type TaskPriority } from "./task-constants";

export const TASK_ERRORS = {
  titleRequired: "Escribe qué hay que hacer.",
  titleTooLong: `Usa ${TASK_TITLE_MAX_LENGTH} caracteres como máximo.`,
  titleInvisible: "Quita los caracteres invisibles o de control del título.",
  area: "Elige un área.",
  project: "Elige un proyecto.",
  milestone: "Elige un hito.",
  areaAndProject: "Elige un área o un proyecto, no los dos.",
  milestoneWithoutProject: "Un hito solo puede elegirse con su proyecto.",
  areaUnavailable: "Esa área ya no está disponible (se archivó o no existe). Elige otra.",
  projectUnavailable:
    "Ese proyecto ya no está disponible (se terminó, se canceló o se eliminó). Elige otro.",
  milestoneUnavailable: "Ese hito no es de este proyecto o ya no existe.",
  priority: "Elige una prioridad.",
  dateInvalid: "Escribe una fecha válida.",
  timeInvalid: "Escribe una hora válida (por ejemplo, 10:00).",
  timeWithoutDate: "Elige primero una fecha para ponerle hora.",
  notFound: "Esta tarea ya no existe (se eliminó).",
} as const;

/** A life area as a task shows it (it may be archived since). */
export type TaskAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
};

export type TaskProjectSummary = { id: string; name: string; status: ProjectStatus };

/** A recurrence rule (T3 edits it; T1 only carries it). */
export type TaskRecurrence = {
  kind: RecurrenceKind;
  interval: number | null;
  weekdays: number[] | null;
  monthDay: number | null;
};

export type TaskTagSummary = { id: string; name: string };

/**
 * What the lists, the rows and the detail get of a task (never the whole row, never the notes:
 * those are detail-only, like projects).
 */
export type TaskItem = {
  id: string;
  title: string;
  priority: TaskPriority;
  /** A day in Lima, YYYY-MM-DD. */
  dueDate: string | null;
  /** HH:MM (24 h, Lima), only with a due date (polish → task-time). */
  dueTime: string | null;
  doneAt: Date | null;
  createdAt: Date;
  /** The task's own area (only without a project). */
  lifeAreaId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  isNextAction: boolean;
  /** The area it shows: its own, or its project's (SPEC-tasks: one source of truth). */
  area: TaskAreaSummary | null;
  project: TaskProjectSummary | null;
  recurrence: TaskRecurrence | null;
  /** Its tags by name (T4 writes them; read here so rows and filters need no second query). */
  tags: TaskTagSummary[];
};

/** A task with neither an area nor a project is in the inbox ("bandeja"). Not a state. */
export function isInInbox(task: Pick<TaskItem, "lifeAreaId" | "projectId">): boolean {
  return task.lifeAreaId === null && task.projectId === null;
}

/** An open project a task can go in, with its area. */
export type TaskTargetProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  area: TaskAreaSummary;
};

/** Where a task can go: the active areas (in their order) and the open projects (by name). */
export type TaskTargets = { areas: TaskAreaSummary[]; projects: TaskTargetProject[] };

/** What the list's "Tarea eliminada" notice needs of a deleted task. */
export type DeletedTask = { id: string; title: string };

/** The title as stored: like names (NFC, collapsed whitespace, trimmed). */
export const normalizeTaskTitle = normalizeName;

const title = z
  .string({ error: TASK_ERRORS.titleRequired })
  .transform(normalizeTaskTitle)
  .pipe(
    z
      .string()
      .min(1, TASK_ERRORS.titleRequired)
      .max(TASK_TITLE_MAX_LENGTH, TASK_ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), TASK_ERRORS.titleInvisible),
  );

/** Ids are uuids: anything else can't be a task (and never reaches Postgres). */
const id = z.uuid({ error: TASK_ERRORS.notFound });

const optionalUuid = (error: string) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.uuid({ error }).nullable(),
  );

/** An optional day (YYYY-MM-DD, a real calendar date). "", null or missing clear it. */
const day = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.iso.date({ error: TASK_ERRORS.dateInvalid }).nullable(),
);

/** An optional time (HH:MM, 24 h). "", null or missing clear it. */
const time = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z
    .string({ error: TASK_ERRORS.timeInvalid })
    .regex(DUE_TIME_PATTERN, TASK_ERRORS.timeInvalid)
    .nullable(),
);

/** A time needs a day: with no date (null) it can't be set (an edit may keep the stored day). */
function checkTime(
  value: { dueDate?: string | null; dueTime?: string | null },
  context: z.RefinementCtx,
) {
  if (value.dueTime != null && value.dueDate === null) {
    context.addIssue({ code: "custom", message: TASK_ERRORS.timeWithoutDate, path: ["dueTime"] });
  }
}

const priority = z.enum(TASK_PRIORITIES, { error: TASK_ERRORS.priority });

/**
 * Where a task goes: an active area, an open project (and optionally one of its milestones), or
 * nothing (the inbox). Never an area and a project: the project's area is the task's.
 */
const placementShape = {
  lifeAreaId: optionalUuid(TASK_ERRORS.area),
  projectId: optionalUuid(TASK_ERRORS.project),
  milestoneId: optionalUuid(TASK_ERRORS.milestone),
};

type PlacementFields = { lifeAreaId: string | null; projectId: string | null; milestoneId: string | null };

function checkPlacement(value: PlacementFields, context: z.RefinementCtx) {
  if (value.lifeAreaId !== null && value.projectId !== null) {
    context.addIssue({ code: "custom", message: TASK_ERRORS.areaAndProject, path: ["projectId"] });
  }
  if (value.milestoneId !== null && value.projectId === null) {
    context.addIssue({
      code: "custom",
      message: TASK_ERRORS.milestoneWithoutProject,
      path: ["milestoneId"],
    });
  }
}

export const taskPlacementSchema = z.object(placementShape).superRefine(checkPlacement);
export type TaskPlacement = z.output<typeof taskPlacementSchema>;

/**
 * Quick capture and inline add: a title, and optionally where it goes, a due date, priority and
 * tags (T4; created on first use, at most 10).
 */
export const createTaskInputSchema = z
  .object({
    title,
    ...placementShape,
    dueDate: day,
    // polish -> task-time: optional, only with a date. The quick capture has no field yet
    // (`capture-nl-dates` fills it).
    dueTime: time.optional(),
    priority: priority.default("medium"),
    // T3: an optional recurrence rule ("Más detalles"); missing or null: none.
    recurrence: optionalRecurrenceSchema.optional(),
    tags: taskTagsSchema.optional(),
  })
  .superRefine(checkPlacement)
  .superRefine(checkTime);

export type CreateTaskInput = z.output<typeof createTaskInputSchema>;

/** Field names of the capture form, in order (focus goes to the first invalid one). */
export const CREATE_TASK_FIELDS = [
  "title",
  "lifeAreaId",
  "projectId",
  "milestoneId",
  "dueDate",
  "dueTime",
  "priority",
  "recurrence",
  "tags",
] as const;

/**
 * An edit of one or more of a task's own fields; what is missing stays as it is. `placement`
 * moves it (all three together: a missing field there means "none").
 */
export const editTaskInputSchema = z
  .object({
    id,
    title: title.optional(),
    priority: priority.optional(),
    dueDate: day.optional(),
    // Missing: unchanged. A null date clears the time too; a time needs a day (an edit that
    // leaves the date out uses the stored one: the data layer checks it).
    dueTime: time.optional(),
    placement: taskPlacementSchema.optional(),
  })
  .superRefine(checkTime);

export type EditTaskInput = z.output<typeof editTaskInputSchema>;

/** Complete, reopen, delete and undo. */
export const taskIdInputSchema = z.object({ id });
