// URLs of the goals screens. Client-safe.

export const GOALS_PATH = "/goals";

/** A goal's page: its bar, pace and the history of its entries. */
export const goalPath = (id: string) => `${GOALS_PATH}/${id}`;

/**
 * `?deleted=<id>` on /goals: that goal was just deleted from its page. The list shows the
 * "Meta eliminada · Deshacer" notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";
