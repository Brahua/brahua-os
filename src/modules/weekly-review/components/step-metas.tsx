import Link from "next/link";
import { SegmentBar } from "@/design-system";
import type { GoalWeekReviewItem } from "@/modules/goals/contracts";
import { GOALS_PATH } from "@/modules/goals/routes";
import type { ProjectWeekReviewItem } from "@/modules/projects/contracts";
import { PROJECTS_PATH, projectPath } from "@/modules/projects/routes";
import { METAS_COPY } from "../review-copy";

/** How many goals and projects the step lists (the rest is one tap away in their screens). */
export const METAS_GOALS_LISTED = 12;
export const METAS_PROJECTS_LISTED = 12;
const SEGMENTS = 10;

const LINK =
  "rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Filled segments of 10 for a 0–1 ratio (all of them only when the goal is reached). */
export function filledOf(ratio: number): number {
  if (ratio >= 1) return SEGMENTS;
  return Math.max(0, Math.min(SEGMENTS - 1, Math.floor(ratio * SEGMENTS)));
}

type StepMetasProps = {
  goals: readonly GoalWeekReviewItem[];
  projects: readonly ProjectWeekReviewItem[];
};

/**
 * Step 3 · Metas y proyectos (SPEC-weekly-review "Pantallas"): the goals in the works with their
 * bar and pace line, and the projects in the works with their progress and next action; a blocked
 * one says what it waits for (a fact, not a reproach). Read-only: everything links to its own
 * screen. A Server Component: nothing here changes on the client.
 */
export function StepMetas({ goals, projects }: StepMetasProps) {
  const shownGoals = goals.slice(0, METAS_GOALS_LISTED);
  const shownProjects = projects.slice(0, METAS_PROJECTS_LISTED);
  return (
    <div className="flex flex-col gap-8" data-review-step="metas">
      <section
        aria-labelledby="review-goals"
        className="flex max-w-160 flex-col gap-3"
        data-metas="goals"
      >
        <h3 id="review-goals" className="bo-text-label text-text-secondary">
          {METAS_COPY.goalsTitle}
        </h3>
        {shownGoals.length === 0 ? (
          <div className="flex flex-col items-start gap-1" data-metas-empty="goals">
            <p className="bo-text-title">{METAS_COPY.goalsEmptyTitle}</p>
            <p className="bo-text-body-sm text-text-secondary">{METAS_COPY.goalsEmptyText}</p>
            <Link href={GOALS_PATH} className={`bo-text-body-sm ${LINK}`}>
              {METAS_COPY.goalsEmptyLink}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-4">
              {shownGoals.map((goal) => (
                <li key={goal.id} className="flex flex-col gap-1.5" data-goal-id={goal.id}>
                  <Link href={goal.href} className={`bo-text-body break-words ${LINK}`}>
                    {goal.title}
                  </Link>
                  {goal.count !== null ? (
                    <>
                      <SegmentBar
                        role="progressbar"
                        total={SEGMENTS}
                        filled={filledOf(goal.ratio)}
                        label={METAS_COPY.goalBar(goal.title, goal.count)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(Math.min(Math.max(goal.ratio, 0), 1) * 100)}
                        aria-valuetext={goal.count}
                      />
                      <p className="bo-text-body-sm">{goal.count}</p>
                    </>
                  ) : null}
                  {goal.line ? (
                    <p className="bo-text-body-sm text-text-secondary" data-goal-line="">
                      {goal.line}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {goals.length > shownGoals.length ? (
              <p className="bo-text-body-sm text-text-secondary">
                {METAS_COPY.shownOf(shownGoals.length, goals.length)}{" "}
                <Link href={GOALS_PATH} className={LINK}>
                  {METAS_COPY.goalsAll}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>

      <section
        aria-labelledby="review-projects"
        className="flex max-w-160 flex-col gap-3"
        data-metas="projects"
      >
        <h3 id="review-projects" className="bo-text-label text-text-secondary">
          {METAS_COPY.projectsTitle}
        </h3>
        {shownProjects.length === 0 ? (
          <div className="flex flex-col items-start gap-1" data-metas-empty="projects">
            <p className="bo-text-title">{METAS_COPY.projectsEmptyTitle}</p>
            <p className="bo-text-body-sm text-text-secondary">{METAS_COPY.projectsEmptyText}</p>
            <Link href={PROJECTS_PATH} className={`bo-text-body-sm ${LINK}`}>
              {METAS_COPY.projectsEmptyLink}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-4">
              {shownProjects.map((project) => (
                <li key={project.id} className="flex flex-col gap-1" data-project-id={project.id}>
                  <p className="bo-text-body break-words">
                    <Link href={projectPath(project.id)} className={LINK}>
                      {project.name}
                    </Link>
                    {project.status !== "active" ? (
                      <span className="bo-text-label text-text-secondary">
                        {" · "}
                        {METAS_COPY.status[project.status] ?? project.status}
                      </span>
                    ) : null}
                  </p>
                  {project.status !== "maintenance" ? (
                    <p className="bo-text-body-sm">
                      {METAS_COPY.progress(project.progressPercent)}
                    </p>
                  ) : null}
                  <p className="bo-text-body-sm break-words text-text-secondary">
                    {project.nextAction
                      ? METAS_COPY.nextAction(project.nextAction.title)
                      : METAS_COPY.noNextAction}
                  </p>
                  {project.blockedBy.length > 0 ? (
                    <p className="bo-text-body-sm break-words" data-blocked="">
                      {METAS_COPY.waitingFor(project.blockedBy.map((b) => b.name).join(", "))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {projects.length > shownProjects.length ? (
              <p className="bo-text-body-sm text-text-secondary">
                {METAS_COPY.shownOf(shownProjects.length, projects.length)}{" "}
                <Link href={PROJECTS_PATH} className={LINK}>
                  {METAS_COPY.projectsAll}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
