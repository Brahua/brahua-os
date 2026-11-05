import Link from "next/link";
import { keyClasses } from "@/design-system";
import { TrainingTodayCard, trainingCard } from "@/modules/health/components/training-today";
import type { HealthTodaySummary } from "@/modules/health/contracts";
import { HEALTH_PATH } from "@/modules/health/routes";
import { TODAY_COPY } from "../today-copy";

/** Id of the section's `<h2 tabIndex={-1}>` (the slots' focus contract, see `TodaySlot`). */
export const TODAY_TRAINING_HEADING_ID = "today-training-title";

/** How many cards «Entreno» shows (0 or 1): the slot's `count` for the empty day. */
export function trainingCount(summary: HealthTodaySummary): number {
  return trainingCard(summary) === null ? 0 : 1;
}

/**
 * «Entreno» on the board (E4 of `health`, SPEC-health "Hoy"), after «Estudio»: the open session
 * («Entreno en curso · Rutina A · 23 min» with «Seguir») or, while the linked habit is due today
 * and not done, «Empezar Rutina B» («Ver entreno» picks another); the card is `health`'s own
 * (`TrainingTodayCard`) inside the board's screen services. Otherwise the section renders nothing
 * (the slot is still always given, `TodaySlot`). A Server Component: the card is the client part.
 */
export function TodayTraining({ summary }: { summary: HealthTodaySummary }) {
  const card = trainingCard(summary);
  if (card === null) return null;
  return (
    <section
      aria-labelledby={TODAY_TRAINING_HEADING_ID}
      className="flex flex-col gap-3"
      data-today-section="training"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={TODAY_TRAINING_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
          {TODAY_COPY.trainingTitle}
        </h2>
        <Link href={HEALTH_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.seeHealth}
        </Link>
      </div>
      <TrainingTodayCard card={card} />
    </section>
  );
}
