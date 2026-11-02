// What `learning` offers other modules (SPEC-learning "Contratos"). Only `today` and
// `weekly-review` may import it, and only this file (eslint.config.mjs). L1 exposes the types; L3
// adds `getLearningTodaySummary(now)`, `getLearningWeekReview(weekStart)` and the progress source
// registered in src/lib/progress-sources.ts.
export type { TrackKind, TrackStatus } from "./learning-constants";
