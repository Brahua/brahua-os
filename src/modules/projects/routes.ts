// URLs of the projects screens. Client-safe.

export const PROJECTS_PATH = "/projects";

/** A project's page. */
export const projectPath = (id: string) => `${PROJECTS_PATH}/${id}`;

/**
 * `?created=1` on a project's page: it was just created from the sheet. The page then moves
 * focus to its heading and announces it, and drops the parameter from the URL.
 */
export const CREATED_PARAM = "created";

/**
 * `?deleted=<id>` on the list: that project was just deleted from its page. The list shows the
 * "Proyecto eliminado · Deshacer" notice, moves focus to its heading and drops the parameter.
 */
export const DELETED_PARAM = "deleted";
