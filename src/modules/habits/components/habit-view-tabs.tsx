import Link from "next/link";
import { cn } from "@/lib/cn";
import { HISTORY_COPY } from "../history-copy";
import { HABIT_VIEWS, habitViewHref, type HabitView } from "../routes";

const LABELS: Record<HabitView, string> = {
  hoy: HISTORY_COPY.viewToday,
  semana: HISTORY_COPY.viewWeek,
};

/**
 * H5: "Hoy · Semana", the views of /habits as links (`?vista=`), like tasks' view switch: the
 * current one is marked (`aria-current="page"`) and drawn like a segmented control's selected key.
 * Links, not tabs: each view is its own URL (back, reload and sharing work).
 */
export function HabitViewTabs({ current }: { current: HabitView }) {
  return (
    <nav aria-label={HISTORY_COPY.viewsLabel}>
      <div className="bo-segmented bo-task-views max-w-80">
        {HABIT_VIEWS.map((view) => (
          <Link
            key={view}
            href={habitViewHref(view)}
            prefetch={false}
            className={cn("bo-segmented__item", view === current && "is-on")}
            aria-current={view === current ? "page" : undefined}
            data-habit-view={view}
          >
            {LABELS[view]}
          </Link>
        ))}
      </div>
    </nav>
  );
}
