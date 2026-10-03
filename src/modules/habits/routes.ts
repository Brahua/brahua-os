// URLs of the habits screens. Client-safe.

export const HABITS_PATH = "/habits";

/** A habit's page (H5: the detail with its calendar). `today` links to it (H6). */
export const habitPath = (id: string) => `${HABITS_PATH}/${id}`;

/** H5: `?vista=` picks the view of /habits (SPEC-habits "Pantallas"), like tasks. */
export const VIEW_PARAM = "vista";

/** The views of /habits, in tab order ("Hoy" is the bare /habits). */
export const HABIT_VIEWS = ["hoy", "semana"] as const;
export type HabitView = (typeof HABIT_VIEWS)[number];

/** The view of a `?vista=` value; anything unknown (or missing) is "Hoy". */
export function parseHabitView(value: string | string[] | undefined): HabitView {
  return value === "semana" ? "semana" : "hoy";
}

/** H5: `?semana=YYYY-MM-DD` picks the week of "Semana" (its Monday). */
export const WEEK_PARAM = "semana";

/** H5: `?mes=YYYY-MM` picks the month of a habit's calendar. */
export const MONTH_PARAM = "mes";

/** The link of a view; "Semana" may name a week (its Monday; none: the current one). */
export function habitViewHref(view: HabitView, monday?: string): string {
  if (view === "hoy") return HABITS_PATH;
  const week = monday ? `&${WEEK_PARAM}=${monday}` : "";
  return `${HABITS_PATH}?${VIEW_PARAM}=semana${week}`;
}

/** A habit's page on a month of its calendar (none: the current month). */
export const habitMonthHref = (id: string, month?: string) =>
  month ? `${habitPath(id)}?${MONTH_PARAM}=${month}` : habitPath(id);

/**
 * `?deleted=<id>` on /habits: that habit was just deleted from its page. "Hoy" shows the "Hábito
 * eliminado · Deshacer" notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";
