"use client";

import { Inbox } from "lucide-react";
import { TaskList } from "@/modules/tasks/components/task-list";
import { isInInbox, type TaskItem } from "@/modules/tasks/task-input";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";
import { ViewEmpty, ViewHeading } from "./view-parts";

/** A task stays in the inbox while it is pending and has neither an area nor a project. */
const inInbox = (task: TaskItem) => task.doneAt === null && isInInbox(task);

type InboxViewProps = {
  tasks: TaskItem[];
  /** The single-key shortcuts are on (`bo_shortcuts`): the empty state mentions `C`. */
  shortcuts: boolean;
  /** The view's heading (tabIndex -1): focus goes there when the last task leaves. */
  headingId: string;
};

/** "Bandeja" (SPEC-tasks): unclassified pending tasks, each with "Clasificar". */
export function InboxView({ tasks, shortcuts, headingId }: InboxViewProps) {
  return (
    <TaskList
      tasks={tasks}
      label={TASKS_COPY.inboxList}
      belongs={inInbox}
      classify
      fallbackFocusId={headingId}
      header={(count) => (
        <ViewHeading
          id={headingId}
          title={TASKS_COPY.inboxTitle}
          count={count}
          help={TASKS_COPY.inboxHelp}
        />
      )}
      empty={
        <ViewEmpty icon={Inbox} title={TASKS_COPY.emptyInboxTitle} view="bandeja">
          <p className="bo-text-body-sm text-text-secondary" data-inbox-empty="">
            {TASKS_COPY.emptyInboxText}
            {/* `C` only acts from 1024 px: hidden (also for screen readers) below that. */}
            {shortcuts ? (
              <span className="hidden lg:inline">{TASKS_COPY.emptyInboxShortcut}</span>
            ) : null}
          </p>
        </ViewEmpty>
      }
    />
  );
}
