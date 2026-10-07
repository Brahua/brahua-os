"use client";

import { CalendarCheck, CalendarRange, CircleCheckBig } from "lucide-react";
import { useCallback } from "react";
import { TaskList } from "@/modules/tasks/components/task-list";
import { useTasksScreen } from "@/modules/tasks/components/tasks-screen";
import type { TaskItem } from "@/modules/tasks/task-input";
import {
  isDueByToday,
  isRecentlyDone,
  isUpcoming,
  upcomingGroup,
} from "@/modules/tasks/task-views";
import { TASK_VIEW_LABELS } from "@/modules/tasks/tasks-copy";
import { VIEWS_COPY } from "@/modules/tasks/views-copy";
import { ViewEmpty, ViewHeading } from "./view-parts";

type DateViewProps = {
  tasks: TaskItem[];
  /** The view's heading (tabIndex -1): focus goes there when the last task leaves. */
  headingId: string;
};

/** "Hoy" (SPEC-tasks): overdue and due today, the oldest first, then priority. */
export function TodayView({ tasks, headingId }: DateViewProps) {
  const { now } = useTasksScreen();
  const belongs = useCallback((task: TaskItem) => isDueByToday(task, now), [now]);
  return (
    <TaskList
      tasks={tasks}
      label={VIEWS_COPY.todayList}
      belongs={belongs}
      postpone
      fallbackFocusId={headingId}
      header={(count) => (
        <ViewHeading
          id={headingId}
          title={TASK_VIEW_LABELS.hoy}
          count={count}
          help={VIEWS_COPY.todayHelp}
        />
      )}
      empty={
        <ViewEmpty icon={CalendarCheck} title={VIEWS_COPY.todayEmptyTitle} view="hoy">
          <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.todayEmptyText}</p>
        </ViewEmpty>
      }
    />
  );
}

/** "Próximas": due in the next 7 days (today excluded), grouped by day ("Mañana", "Jueves 8…"). */
export function UpcomingView({ tasks, headingId }: DateViewProps) {
  const { now } = useTasksScreen();
  const belongs = useCallback((task: TaskItem) => isUpcoming(task, now), [now]);
  const groupOf = useCallback((task: TaskItem) => upcomingGroup(task, now), [now]);
  return (
    <TaskList
      tasks={tasks}
      label={VIEWS_COPY.upcomingList}
      belongs={belongs}
      groupOf={groupOf}
      postpone
      fallbackFocusId={headingId}
      header={(count) => (
        <ViewHeading
          id={headingId}
          title={TASK_VIEW_LABELS.proximas}
          count={count}
          help={VIEWS_COPY.upcomingHelp}
        />
      )}
      empty={
        <ViewEmpty icon={CalendarRange} title={VIEWS_COPY.upcomingEmptyTitle} view="proximas">
          <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.upcomingEmptyText}</p>
        </ViewEmpty>
      }
    />
  );
}

/** "Hechas": done in the last 30 days, the most recent first, each with "Deshacer". */
export function DoneView({ tasks, headingId }: DateViewProps) {
  const { now } = useTasksScreen();
  const belongs = useCallback((task: TaskItem) => isRecentlyDone(task, now), [now]);
  return (
    <TaskList
      tasks={tasks}
      label={VIEWS_COPY.doneList}
      belongs={belongs}
      reopenable
      fallbackFocusId={headingId}
      header={(count) => (
        <ViewHeading
          id={headingId}
          title={TASK_VIEW_LABELS.hechas}
          count={count}
          help={VIEWS_COPY.doneHelp}
        />
      )}
      empty={
        <ViewEmpty icon={CircleCheckBig} title={VIEWS_COPY.doneEmptyTitle} view="hechas">
          <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.doneEmptyText}</p>
        </ViewEmpty>
      }
    />
  );
}
