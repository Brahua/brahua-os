import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { getGoalsWeekReview } from "@/modules/goals/contracts";
import { getHabitsWeekCompleteDays, getHabitsWeekSummary } from "@/modules/habits/contracts";
import { getProjectsWeekReview } from "@/modules/projects/contracts";
import { getTasksWeekReview } from "@/modules/tasks/contracts";
import { ReviewShell } from "@/modules/weekly-review/components/review-shell";
import { StepLogros } from "@/modules/weekly-review/components/step-logros";
import { StepPendientes } from "@/modules/weekly-review/components/step-pendientes";
import { StepSoon } from "@/modules/weekly-review/components/step-soon";
import { buildLogros } from "@/modules/weekly-review/logros";
import { hasReview } from "@/modules/weekly-review/queries";
import { REVIEW_COPY } from "@/modules/weekly-review/review-copy";
import { parseStep, STEP_PARAM, WEEK_PARAM, type ReviewStep } from "@/modules/weekly-review/routes";
import {
  currentWeekStart,
  defaultReviewWeek,
  moveTargets,
  parseWeekParam,
  previousMonday,
} from "@/modules/weekly-review/week";

const HEADING_ID = "review-title";

type SearchParams = Record<string, string | string[] | undefined>;

type ReviewPageProps = {
  searchParams: Promise<SearchParams>;
};

/** Each step has its own title: moving between steps is announced. */
export async function generateMetadata({ searchParams }: ReviewPageProps): Promise<Metadata> {
  const step = parseStep((await searchParams)[STEP_PARAM]);
  return { title: `${REVIEW_COPY.steps[step - 1]} · ${REVIEW_COPY.pageTitle} · brahua-os` };
}

/**
 * Revisión semanal (SPEC-weekly-review "Pantallas"): the ritual, one step per screen
 * (`?paso=1…4`) for one week (`?semana=`, a Monday; the default is the week in progress, and on
 * Monday and Tuesday the previous one while it has no review). W2 builds steps 1 (Logros) and 2
 * (Pendientes); 3 and 4 are W3's and say so. Every step is a plain page: leaving and coming back
 * loses nothing. Reads only through the providers' contracts, a fixed number of queries per step.
 */
export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  await requireOwner();
  const search = await searchParams;
  // One instant for the whole page: the week, the targets and the day «Otro día…» starts from.
  const now = new Date();
  const today = ownerDateKey(now);
  const step: ReviewStep = parseStep(search[STEP_PARAM]);
  const current = currentWeekStart(now);
  const weekStart =
    parseWeekParam(search[WEEK_PARAM], now) ??
    defaultReviewWeek(now, await hasReview(previousMonday(current)));

  let content: React.ReactNode;
  if (step === 1) {
    const [habits, completeDays, tasks, projects, goals] = await Promise.all([
      getHabitsWeekSummary(weekStart, now),
      getHabitsWeekCompleteDays(weekStart, now),
      getTasksWeekReview(weekStart),
      getProjectsWeekReview(weekStart, now),
      getGoalsWeekReview(weekStart, now),
    ]);
    content = (
      <StepLogros
        model={buildLogros(weekStart, { habits, completeDays, tasks, projects, goals })}
      />
    );
  } else if (step === 2) {
    const tasks = await getTasksWeekReview(weekStart);
    content = (
      <StepPendientes
        // The step is keyed by its week: another week starts with a clean screen state.
        key={weekStart}
        today={today}
        targets={moveTargets(weekStart, now)}
        open={tasks.open}
        openCount={tasks.openCount}
        inboxCount={tasks.inboxCount}
      />
    );
  } else {
    // W3 slot: step 3 (Metas y proyectos) and step 4 (Próxima semana, «Cerrar la semana»).
    content = <StepSoon />;
  }

  return (
    <ScreenServicesProvider
      label={REVIEW_COPY.noticesLabel}
      actionHint={REVIEW_COPY.undoHint}
      day={{ today, changedMessage: REVIEW_COPY.newDay }}
    >
      <ReviewShell
        headingId={HEADING_ID}
        weekStart={weekStart}
        step={step}
        currentWeek={weekStart === current ? null : current}
      >
        {content}
      </ReviewShell>
    </ScreenServicesProvider>
  );
}
