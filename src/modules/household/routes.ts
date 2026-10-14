// URLs of the household screens. Client-safe.

export const HOUSEHOLD_PATH = "/household";

/**
 * The views of `/household` (`?vista=`). H1 has only the cleaning; the shopping list (H2) and the
 * recipes (H3) join this list and the page's switch.
 */
export const HOUSEHOLD_VIEWS = ["limpieza"] as const;
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
