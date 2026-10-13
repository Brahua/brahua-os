import Link from "next/link";
import { StatNumber } from "@/design-system";
import { LOGROS_COPY } from "../review-copy";
import type { LogrosModel } from "../logros";

type StepLogrosProps = { model: LogrosModel };

/**
 * Step 1 · Logros (SPEC-weekly-review "Pantallas"): «Días completos esta semana: N», the four big
 * figures and, under them, what is worth naming. A Server Component: nothing here changes on the
 * client. No comparisons with other weeks; a week with nothing to count says so gently.
 */
export function StepLogros({ model }: StepLogrosProps) {
  const { habits } = model;
  const figures: { key: string; value: string | number; label: string }[] = [
    {
      key: "habits",
      value:
        habits.expected > 0
          ? LOGROS_COPY.habitsFigure(habits.done, habits.expected)
          : LOGROS_COPY.noHabitsFigure,
      label: LOGROS_COPY.habits,
    },
    { key: "tasks", value: model.tasksDone, label: LOGROS_COPY.tasksDone },
    { key: "milestones", value: model.milestonesDone, label: LOGROS_COPY.milestones },
    { key: "goals", value: model.goalsAchieved, label: LOGROS_COPY.goals },
  ];
  return (
    <div className="flex flex-col gap-6" data-review-step="logros">
      <p className="bo-text-body" data-complete-days="">
        {LOGROS_COPY.completeDays(model.completeDays)}
      </p>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-review-figures="">
        {figures.map(({ key, value, label }) => (
          <div key={key} className="bo-card gap-1" data-figure={key}>
            <dt className="bo-text-label order-2 text-text-secondary">{label}</dt>
            <dd className="order-1">
              <StatNumber value={value} size="lg" />
            </dd>
          </div>
        ))}
      </dl>

      {model.quiet ? (
        <div className="flex max-w-160 flex-col gap-1" data-review-quiet="">
          <p className="bo-text-title">{LOGROS_COPY.quietTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{LOGROS_COPY.quietText}</p>
        </div>
      ) : null}

      {model.topHabits.length > 0 ? (
        <Highlight title={LOGROS_COPY.habitsHighlights} name="habits">
          {model.topHabits.map((habit) => (
            <li key={habit.id} className="break-words">
              {LOGROS_COPY.habitLine(habit.name, habit.done, habit.expected)}
            </li>
          ))}
        </Highlight>
      ) : null}

      {model.recentTasks.length > 0 ? (
        <Highlight title={LOGROS_COPY.tasksHighlights} name="tasks">
          {model.recentTasks.map((task) => (
            <li key={task.id} className="break-words">
              {task.title}
            </li>
          ))}
        </Highlight>
      ) : null}

      {model.milestones.length > 0 ? (
        <Highlight title={LOGROS_COPY.milestonesHighlights} name="milestones">
          {model.milestones.map((milestone) => (
            <li key={milestone.id} className="break-words">
              {LOGROS_COPY.milestoneLine(milestone.title, milestone.projectName)}
            </li>
          ))}
        </Highlight>
      ) : null}

      {model.goals.length > 0 ? (
        <Highlight title={LOGROS_COPY.goalsHighlights} name="goals">
          {model.goals.map((goal) => (
            <li key={goal.id} className="break-words">
              <Link
                href={goal.href}
                className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {goal.title}
              </Link>
            </li>
          ))}
        </Highlight>
      ) : null}
    </div>
  );
}

function Highlight({
  title,
  name,
  children,
}: {
  title: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex max-w-160 flex-col gap-2" data-highlight={name}>
      <h3 className="bo-text-label text-text-secondary">{title}</h3>
      <ul className="bo-text-body flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}
