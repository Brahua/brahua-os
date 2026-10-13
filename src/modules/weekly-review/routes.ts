// URLs of the weekly review screens. Client-safe.

export const REVIEW_PATH = "/review";

/** The steps of the ritual, in order (`?paso=1…4`). */
export const REVIEW_STEPS = [1, 2, 3, 4] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** `?paso=` picks the step; `?semana=` the week (a Monday). */
export const STEP_PARAM = "paso";
export const WEEK_PARAM = "semana";

/**
 * A step's URL. The first step of the default week is the bare /review; `weekStart` (a Monday)
 * adds `?semana=` for any other week.
 */
export function reviewStepPath(step: ReviewStep = 1, weekStart?: string): string {
  const params = new URLSearchParams();
  if (step !== 1) params.set(STEP_PARAM, String(step));
  if (weekStart) params.set(WEEK_PARAM, weekStart);
  const query = params.toString();
  return query ? `${REVIEW_PATH}?${query}` : REVIEW_PATH;
}

/** The step of a `?paso=` value; anything unknown (or missing) is the first. */
export function parseStep(value: string | string[] | undefined): ReviewStep {
  const step = typeof value === "string" ? Number(value) : NaN;
  return (REVIEW_STEPS as readonly number[]).includes(step) ? (step as ReviewStep) : 1;
}
