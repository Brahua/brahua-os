import { weekGoal } from "../pace";
import { SESSIONS_COPY as COPY } from "../sessions-copy";

/**
 * A track's week (SPEC-learning "Meta semanal"): «1 h 20 de 3 h esta semana» and «Te faltan 1 h 40»,
 * «Semana cumplida», or only what was studied without a target. Nothing without a target and
 * without time. Never a debt or red. Renders on the server too.
 */
export function WeekLine({ minutes, target }: { minutes: number; target: number | null }) {
  const goal = weekGoal(minutes, target);
  if (!goal) return null;
  return (
    <p className="bo-text-body-sm text-text-secondary" data-track-week={goal.kind}>
      {goal.kind === "free"
        ? COPY.weekFree(goal.minutes)
        : goal.kind === "met"
          ? COPY.weekMet(goal.minutes, goal.target)
          : `${COPY.weekProgress(goal.minutes, goal.target)} · ${COPY.weekLeft(goal.left)}`}
    </p>
  );
}
