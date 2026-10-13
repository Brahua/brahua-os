import Link from "next/link";
import type { GoalItem } from "../goal-input";
import { readGoal } from "../goal-text";
import { GOALS_COPY } from "../goals-copy";
import { periodLabel, periodOf } from "../pace";
import { goalPath } from "../routes";
import { GoalBar } from "./goal-bar";

type LinkedGoalsSectionProps = {
  /** The habit's or project's name, for the section's description. */
  sourceName: string;
  goals: readonly GoalItem[];
  /** Lima's today: every goal reads its pace for the same day. */
  today: string;
};

/**
 * The "Metas" section of a habit's or project's page (SPEC-goals historia 7): the goals that follow
 * it, each with its period, bar and count and a link to its page. Nothing when there are none.
 * A Server Component: the page is read-only here (a goal is edited on its own page). The status is
 * a word ("Lograda"), never only a color.
 */
export function LinkedGoalsSection({ sourceName, goals, today }: LinkedGoalsSectionProps) {
  if (goals.length === 0) return null;
  return (
    <section
      aria-labelledby="linked-goals-title"
      className="flex flex-col gap-3"
      data-linked-goals=""
    >
      <div className="flex flex-col gap-1">
        <h2 id="linked-goals-title" className="bo-text-title">
          {GOALS_COPY.linkedTitle}
        </h2>
        <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.linkedHint(sourceName)}</p>
      </div>
      <ul aria-label={GOALS_COPY.linkedList} className="bo-list max-w-160">
        {goals.map((goal) => {
          const reading = readGoal(goal, today);
          return (
            <li
              key={goal.id}
              data-linked-goal={goal.id}
              className="flex flex-col gap-2 bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <Link
                  href={goalPath(goal.id)}
                  className="bo-text-body line-clamp-2 min-w-0 flex-1 rounded-sm font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  title={goal.title}
                  aria-label={GOALS_COPY.linkedOpen(goal.title)}
                >
                  {goal.title}
                </Link>
                {goal.status === "achieved" ? (
                  <span className="bo-text-label shrink-0 text-text-secondary">
                    {GOALS_COPY.achievedBadge}
                  </span>
                ) : null}
              </div>
              <p className="bo-text-label text-text-secondary">{periodLabel(periodOf(goal))}</p>
              {reading.kind === "ok" ? (
                <>
                  <GoalBar
                    title={goal.title}
                    value={reading.value}
                    target={reading.target}
                    count={reading.count}
                  />
                  <p className="bo-text-body-sm" data-goal-count="">
                    {reading.count}
                  </p>
                  {reading.line ? (
                    <p className="bo-text-body-sm text-text-secondary">{reading.line}</p>
                  ) : null}
                </>
              ) : (
                <p className="bo-text-body-sm text-text-secondary">{reading.line}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
