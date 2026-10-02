// Validation and client types of `projects` (SPEC-projects "Estructura"). Client-safe: the
// server actions are the authority, and the forms run the same schemas first so errors show
// without a round trip.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system/areas";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_OBJECTIVE_MAX_LENGTH,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type ProjectPriority,
  type ProjectStatus,
} from "./project-constants";
import { CLOSED_STATUSES, OPEN_STATUSES } from "./project-close";

export {
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_OBJECTIVE_MAX_LENGTH,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type ProjectPriority,
  type ProjectStatus,
} from "./project-constants";

export const PROJECT_ERRORS = {
  nameRequired: "El nombre es obligatorio.",
  nameTooLong: `Usa ${PROJECT_NAME_MAX_LENGTH} caracteres como máximo.`,
  nameInvisible: "Quita los caracteres invisibles o de control del nombre.",
  area: "Elige un área.",
  areaUnavailable:
    "Esa área ya no está disponible (se archivó o no existe). Elige otra para el proyecto.",
  status: "Elige un estado.",
  priority: "Elige una prioridad.",
  objectiveTooLong: `Usa ${PROJECT_OBJECTIVE_MAX_LENGTH} caracteres como máximo.`,
  objectiveInvisible: "Quita los caracteres invisibles o de control del objetivo.",
  dateInvalid: "Escribe una fecha válida.",
  dueBeforeStart: "La fecha de fin no puede ser anterior a la de inicio.",
  notFound: "Este proyecto ya no existe (se eliminó). Vuelve a la lista de proyectos.",
} as const;

/**
 * States a new project can start in (the open ones). Terminado and Cancelado are left out: a
 * project is created to be worked on, and finishing or canceling it happens from its detail.
 */
export const CREATE_PROJECT_STATUSES = OPEN_STATUSES;

/** The life area as a project shows it (the area may be archived since). */
export type ProjectAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
};

/** What the list, the cards and the detail get of a project (never the whole row). */
export type ProjectSummary = {
  id: string;
  name: string;
  objective: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  /** Days in Lima, YYYY-MM-DD. */
  startDate: string | null;
  dueDate: string | null;
  /** When it moved to Terminado. Set only while it is done (the database CHECK says so too). */
  completedAt: Date | null;
  area: ProjectAreaSummary;
};

/**
 * A project as its page reads it: the summary plus the columns only the detail shows, so the
 * list never loads them.
 */
export type ProjectDetail = ProjectSummary & {
  /** Markdown, up to 20 000 characters (P5). */
  notes: string | null;
};

/** What the list's "Proyecto eliminado" notice needs of a deleted project. */
export type DeletedProject = { id: string; name: string };

/** The name as stored: like area names (NFC, collapsed whitespace, trimmed). */
export const normalizeProjectName = normalizeName;

const name = z
  .string({ error: PROJECT_ERRORS.nameRequired })
  .transform(normalizeProjectName)
  .pipe(
    z
      .string()
      .min(1, PROJECT_ERRORS.nameRequired)
      .max(PROJECT_NAME_MAX_LENGTH, PROJECT_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), PROJECT_ERRORS.nameInvisible),
  );

/** Ids are uuids: anything else can't be a project (and never reaches Postgres). */
const id = z.uuid({ error: PROJECT_ERRORS.notFound });

/**
 * The objective as stored: one paragraph ("what done looks like"), whitespace collapsed like
 * names, up to 280 characters. Empty (or null) clears it.
 */
const objective = z
  .string()
  .nullable()
  .transform((value) => normalizeName(value ?? ""))
  .pipe(
    z
      .string()
      .max(PROJECT_OBJECTIVE_MAX_LENGTH, PROJECT_ERRORS.objectiveTooLong)
      .refine((value) => !hasInvisibleCharacters(value), PROJECT_ERRORS.objectiveInvisible),
  )
  .transform((value) => (value === "" ? null : value));

/** An optional day (YYYY-MM-DD, a real calendar date). "", null or missing clear it. */
const day = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.iso.date({ error: PROJECT_ERRORS.dateInvalid }).nullable(),
);

/** Create: name, an active life area and the starting state (Idea by default). */
export const createProjectInputSchema = z.object({
  name,
  lifeAreaId: z.uuid({ error: PROJECT_ERRORS.area }),
  status: z.enum(CREATE_PROJECT_STATUSES, { error: PROJECT_ERRORS.status }).default("idea"),
});

export type CreateProjectInput = z.output<typeof createProjectInputSchema>;

/** Field names shown in the create form, in order (focus goes to the first invalid one). */
export const CREATE_PROJECT_FIELDS = ["name", "lifeAreaId", "status"] as const;
export type CreateProjectField = (typeof CREATE_PROJECT_FIELDS)[number];

// ── Detail (P2): one schema per edit, each with the project's id ────────────────────────────

/** Delete and undo. */
export const projectIdInputSchema = z.object({ id });

export const renameProjectInputSchema = z.object({ id, name });

/** Any of the six states (moving to Terminado stamps `completed_at`; leaving it clears it). */
export const changeProjectStatusInputSchema = z.object({
  id,
  status: z.enum(PROJECT_STATUSES, { error: PROJECT_ERRORS.status }),
});

export const changeProjectPriorityInputSchema = z.object({
  id,
  priority: z.enum(PROJECT_PRIORITIES, { error: PROJECT_ERRORS.priority }),
});

/** An active area. Sending the project's own (even if archived since) changes nothing. */
export const changeProjectAreaInputSchema = z.object({
  id,
  lifeAreaId: z.uuid({ error: PROJECT_ERRORS.area }),
});

export const updateProjectObjectiveInputSchema = z.object({ id, objective });

/**
 * Both dates at once, so the end is always checked against the start (YYYY-MM-DD compares as
 * text). The error goes on the end date's field.
 */
export const updateProjectDatesInputSchema = z
  .object({ id, startDate: day, dueDate: day })
  .refine(
    ({ startDate, dueDate }) => startDate === null || dueDate === null || dueDate >= startDate,
    { error: PROJECT_ERRORS.dueBeforeStart, path: ["dueDate"] },
  );

export type UpdateProjectDatesInput = z.output<typeof updateProjectDatesInputSchema>;

// ── Cerrar proyecto (Checkpoint final) ──────────────────────────────────────────────────────

/** Terminado or Cancelado, confirmed on the page ("Reabrir" takes `projectIdInputSchema`). */
export const closeProjectInputSchema = z.object({
  id,
  status: z.enum(CLOSED_STATUSES, { error: PROJECT_ERRORS.status }),
});
