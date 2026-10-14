// URLs of the household screens. Client-safe.

export const HOUSEHOLD_PATH = "/household";

/**
 * The views of `/household` (`?vista=`): the cleaning, the shopping list and the recipes.
 */
export const HOUSEHOLD_VIEWS = ["limpieza", "compras", "recetas"] as const;
export type HouseholdView = (typeof HOUSEHOLD_VIEWS)[number];

export const VIEW_PARAM = "vista";
/** `?agrupar=` picks how the cleaning is grouped: by zone (default) or by day. */
export const GROUP_PARAM = "agrupar";
export const CLEANING_GROUPS = ["zona", "dia"] as const;
export type CleaningGroup = (typeof CLEANING_GROUPS)[number];

/** The view of a `?vista=` value; anything unknown (or missing) is the first. */
export function parseView(value: string | string[] | undefined): HouseholdView {
  return (HOUSEHOLD_VIEWS as readonly string[]).includes(value as string)
    ? (value as HouseholdView)
    : HOUSEHOLD_VIEWS[0];
}

/** The grouping of a `?agrupar=` value; anything unknown (or missing) is by zone. */
export function parseGroup(value: string | string[] | undefined): CleaningGroup {
  return value === "dia" ? "dia" : "zona";
}

/** A view's URL; the default grouping and the first view stay out of the query. */
export function householdPath(view: HouseholdView = HOUSEHOLD_VIEWS[0], group?: CleaningGroup) {
  const params = new URLSearchParams();
  if (view !== HOUSEHOLD_VIEWS[0]) params.set(VIEW_PARAM, view);
  if (group && group !== "zona") params.set(GROUP_PARAM, group);
  const query = params.toString();
  return query ? `${HOUSEHOLD_PATH}?${query}` : HOUSEHOLD_PATH;
}

/**
 * The recipes' URL with its filters: the meal (`?tipo=`) and the weekday (`?dia=`, ISO 1–7). A
 * filter that is null stays out of the query.
 */
export function recipesPath(meal: string | null = null, day: number | null = null): string {
  const params = new URLSearchParams({ [VIEW_PARAM]: "recetas" });
  if (meal) params.set("tipo", meal);
  if (day) params.set("dia", String(day));
  return `${HOUSEHOLD_PATH}?${params.toString()}`;
}
