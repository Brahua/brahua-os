// What `today` takes from `health` to draw «Entreno» (E4, SPEC-health "Hoy"): the rule that picks
// the card from `getHealthTodaySummary` and the card itself (a client component). The one file of
// `components/` that `today` may import (eslint.config.mjs, HEALTH_FOR_TODAY). Not a client module:
// `trainingCard` also runs on the server (the page counts the section for the empty day).
export { trainingCard, type TrainingCard } from "../today-summary";
export { TrainingTodayCard } from "./training-today-card";
