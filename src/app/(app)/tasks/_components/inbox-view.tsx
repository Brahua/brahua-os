"use client";

import { Inbox } from "lucide-react";
import { Icon } from "@/design-system";
import { TaskList } from "@/modules/tasks/components/task-list";
import { isInInbox, type TaskItem } from "@/modules/tasks/task-input";
import { TASKS_COPY } from "@/modules/tasks/tasks-copy";

/** A task stays in the inbox while it is pending and has neither an area nor a project. */
const inInbox = (task: TaskItem) => task.doneAt === null && isInInbox(task);

type InboxViewProps = {
  tasks: TaskItem[];
  /** The view's heading (tabIndex -1): focus goes there when the last task leaves. */
  headingId: string;
};

/** "Bandeja" (SPEC-tasks): unclassified pending tasks, each with "Clasificar". */
export function InboxView({ tasks, headingId }: InboxViewProps) {
  return (
    <TaskList
      tasks={tasks}
      label={TASKS_COPY.inboxList}
      belongs={inInbox}
      classify
      fallbackFocusId={headingId}
      empty={
        <div className="bo-card max-w-160 items-start" data-inbox-empty="">
          <Icon icon={Inbox} size="xl" className="text-text-secondary" />
          <h3 className="bo-text-title">{TASKS_COPY.emptyInboxTitle}</h3>
          <p className="bo-text-body-sm text-text-secondary">{TASKS_COPY.emptyInboxText}</p>
        </div>
      }
    />
  );
}
