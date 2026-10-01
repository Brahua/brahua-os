// Validation and client types of `projects` (SPEC-projects "Estructura"). Client-safe: the
// server actions are the authority, and the forms run the same schemas first so errors show
// without a round trip.
import { z } from "zod";
import type { AreaColor, AreaIconName } from "@/design-system/areas";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  PROJECT_NAME_MAX_LENGTH,
  type ProjectPriority,
  type ProjectStatus,
} from "./project-constants";

export {
  PROJECT_NAME_MAX_LENGTH,
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
} as const;

/**
 * States a new project can start in. Terminado and Cancelado are left out: a project is created
 * to be worked on, and finishing or canceling it happens from its detail.
 */
export const CREATE_PROJECT_STATUSES = [
  "idea",
  "active",
  "paused",
  "maintenance",
] as const satisfies readonly ProjectStatus[];

/** The life area as a project shows it (the area may be archived since). */
export type ProjectAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
};

/** What the list and the cards get of a project (never the whole row). */
export type ProjectSummary = {
  id: string;
  name: string;
  objective: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  /** A day in Lima, YYYY-MM-DD. */
  dueDate: string | null;
  area: ProjectAreaSummary;
};

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
