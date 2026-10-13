import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { getGoalsWeekReview, getWeeklyObjectiveForWeek } from "@/modules/goals/contracts";
import { getHabitsWeekCompleteDays, getHabitsWeekSummary } from "@/modules/habits/contracts";
import { getProjectsWeekReview } from "@/modules/projects/contracts";
import { getTasksWeekReview } from "@/modules/tasks/contracts";
import { ReviewShell } from "@/modules/weekly-review/components/review-shell";
import { StepLogros } from "@/modules/weekly-review/components/step-logros";
import { StepPendientes } from "@/modules/weekly-review/components/step-pendientes";
import { StepMetas } from "@/modules/weekly-review/components/step-metas";
import { StepProxima } from "@/modules/weekly-review/components/step-proxima";
import { ClosingScreen } from "@/modules/weekly-review/components/closing-screen";
import { PreviousWeeks } from "@/modules/weekly-review/components/previous-weeks";
import { buildLogros } from "@/modules/weekly-review/logros";
import { getPreviousWeeks, getReviewRow, hasReview } from "@/modules/weekly-review/queries";
import { REVIEW_COPY } from "@/modules/weekly-review/review-copy";
import {
  CLOSED_PARAM,
  parseStep,
  STEP_PARAM,
  WEEK_PARAM,
  type ReviewStep,
} from "@/modules/weekly-review/routes";
import {
  currentWeekStart,
  defaultReviewWeek,
  moveTargets,
  nextMonday,
  parseWeekParam,
  previousMonday,
  weekRange,
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

/** The five readings of step 1 and of the closing screen, as the figures of the week. */
async function readLogros(weekStart: string, now: Date) {
  const [habits, completeDays, tasks, projects, goals] = await Promise.all([
    getHabitsWeekSummary(weekStart, now),
    getHabitsWeekCompleteDays(weekStart, now),
    getTasksWeekReview(weekStart),
    getProjectsWeekReview(weekStart, now),
    getGoalsWeekReview(weekStart, now),
  ]);
  return buildLogros(weekStart, { habits, completeDays, tasks, projects, goals });
}

/**
 * Revisión semanal (SPEC-weekly-review "Pantallas"): the ritual, one step per screen
 * (`?paso=1…4`) for one week (`?semana=`, a Monday; the default is the week in progress, and on
 * Monday and Tuesday the previous one while it has no review). Step 1 (Logros) ends with
 * «Semanas anteriores»; 2 is Pendientes, 3 Metas y proyectos and 4 Próxima semana with «Cerrar la
 * semana», which leads to the closing screen (`?cerrada=1`, only for a week that is closed). Every
 * step is a plain page: leaving and coming back loses nothing. Reads only through the providers'
 * contracts, a fixed number of queries per step.
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
  let closing = false;
  if (step === 1) {
    const [model, previous] = await Promise.all([
      readLogros(weekStart, now),
      getPreviousWeeks(now),
    ]);
    content = (
      <>
        <StepLogros model={model} />
        <PreviousWeeks weeks={previous} />
      </>
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
  } else if (step === 3) {
    const [goals, projects] = await Promise.all([
      getGoalsWeekReview(weekStart, now),
      getProjectsWeekReview(weekStart, now),
    ]);
    content = <StepMetas goals={goals.active} projects={projects.projects} />;
  } else {
    const next = nextMonday(weekStart);
    const [row, objective] = await Promise.all([
      getReviewRow(weekStart),
      getWeeklyObjectiveForWeek(next),
    ]);
    // The closing screen only for a week that is really closed (a stale or typed URL gets the form).
    if (search[CLOSED_PARAM] === "1" && row) {
      closing = true;
      const [model, previous] = await Promise.all([
        readLogros(weekStart, now),
        getPreviousWeeks(now),
      ]);
      content = (
        <>
          <ClosingScreen
            headingId={HEADING_ID}
            model={model}
            note={row.note}
            objective={objective?.text ?? null}
          />
          <PreviousWeeks weeks={previous} />
        </>
      );
    } else {
      content = (
        <StepProxima
          key={weekStart}
          weekStart={weekStart}
          nextRange={weekRange(next)}
          objective={objective?.text ?? null}
          note={row?.note ?? null}
          closed={row !== null}
        />
      );
    }
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
        closing={closing}
        currentWeek={weekStart === current ? null : current}
      >
        {content}
      </ReviewShell>
    </ScreenServicesProvider>
  );
}
