// Plain constants of `projects` shared by the Zod schemas (client and server) and the database
// CHECK constraints (SPEC-projects "Modelo de datos"). No server code: the client imports them.

/** Lifecycle of a project. UI: Idea, Activo, Pausado, Mantenimiento, Terminado, Cancelado. */
export const PROJECT_STATUSES = [
  "idea",
  "active",
  "paused",
  "maintenance",
  "done",
  "canceled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Priority. UI: Baja, Media, Alta. */
export const PROJECT_PRIORITIES = ["low", "medium", "high"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_OBJECTIVE_MAX_LENGTH = 280;
export const PROJECT_NOTES_MAX_LENGTH = 20_000;
export const MILESTONE_TITLE_MAX_LENGTH = 120;
export const PROJECT_LINK_URL_MAX_LENGTH = 2048;
export const PROJECT_LINK_LABEL_MAX_LENGTH = 80;
