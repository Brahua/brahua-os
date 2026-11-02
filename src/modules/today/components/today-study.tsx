import Link from "next/link";
import { keyClasses } from "@/design-system";
import { StudyTodayCards } from "@/modules/learning/components/study-today";
import type { LearningTodaySummary } from "@/modules/learning/contracts";
import { LEARNING_PATH } from "@/modules/learning/routes";
import { TODAY_COPY } from "../today-copy";

/** Id of the section's `<h2 tabIndex={-1}>` (the slots' focus contract, see `TodaySlot`). */
export const TODAY_STUDY_HEADING_ID = "today-study-title";

/**
 * "Estudio" on the board (L3 of `learning`, SPEC-learning "Hoy"): a «Sigue con» card per track in
 * progress (≤ 2), drawn by `learning`'s `StudyTodayCards` (next step and «Hecho», steps done, the
 * week, «Estudiar» / «Detener») inside the board's screen services. Tracks never leave from here
 * (only their page finishes or pauses them), so without tracks in progress the section renders
 * nothing; the slot is still always given (`TodaySlot`). A Server Component: the cards are the
 * client part.
 */
export function TodayStudy({ summary }: { summary: LearningTodaySummary }) {
  if (summary.tracks.length === 0) return null;
  return (
    <section
      aria-labelledby={TODAY_STUDY_HEADING_ID}
      className="flex flex-col gap-3"
      data-today-section="study"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={TODAY_STUDY_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
          {TODAY_COPY.studyTitle}
        </h2>
        <Link href={LEARNING_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.seeLearning}
        </Link>
      </div>
      <StudyTodayCards
        tracks={summary.tracks}
        running={summary.running}
        label={TODAY_COPY.studyList}
      />
    </section>
  );
}
