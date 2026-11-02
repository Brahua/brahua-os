// URLs of the learning screens. Client-safe.

export const LEARNING_PATH = "/learning";

/** A track's page: its syllabus, status and settings. */
export const trackPath = (id: string) => `${LEARNING_PATH}/${id}`;

/**
 * `?deleted=<id>` on /learning: that track was just deleted from its page. The list shows the
 * «Frente eliminado · Deshacer» notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";
