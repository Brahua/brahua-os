// URLs of the health screens. Client-safe.

export const HEALTH_PATH = "/health";

/** The exercise catalogue. */
export const EXERCISES_PATH = `${HEALTH_PATH}/exercises`;

/** An exercise's page: its data (E1), its records and history (E3). */
export const exercisePath = (id: string) => `${EXERCISES_PATH}/${id}`;

/** A routine's page: its exercises with their targets and order. */
export const routinePath = (id: string) => `${HEALTH_PATH}/routines/${id}`;

/**
 * `?deleted=<id>` on /health (a routine) or /health/exercises (an exercise): it was just deleted
 * from its page. The list shows the «… eliminado · Deshacer» notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";

/** Every session, the newest first (E2). */
export const SESSIONS_PATH = `${HEALTH_PATH}/sessions`;

/** A session's screen: the open one, or a finished one (editable). */
export const sessionPath = (id: string) => `${SESSIONS_PATH}/${id}`;

/** `?n=<count>` on /health/sessions: how many it shows («Ver más» adds a page). */
export const SESSIONS_COUNT_PARAM = "n";
