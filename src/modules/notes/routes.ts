// URLs of the notes screens. Client-safe.

export const NOTES_PATH = "/notes";

/** A note's page: `key` is a day (`YYYY-MM-DD`, the daily note) or a knowledge note's id. */
export const notePath = (key: string) => `${NOTES_PATH}/${key}`;

/** The daily note of a Lima day (`YYYY-MM-DD`). */
export const dailyNotePath = (day: string) => notePath(day);

/**
 * `?deleted=<id>` on /notes: that note was just deleted from its page. The list shows the «Nota
 * eliminada · Deshacer» notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";

/** The list's filters in the URL: `?tipo=diario|notas`, `?area=<id>` and `?n=<how many>`. */
export const KIND_PARAM = "tipo";
export const AREA_PARAM = "area";
export const SHOWN_PARAM = "n";

/** N4: the search text in the URL (`?q=`), so a reload keeps the results. */
export const SEARCH_PARAM = "q";
