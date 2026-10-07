"use client";

import {
  createContext,
  startTransition,
  use,
  useCallback,
  useMemo,
  useOptimistic,
  useState,
} from "react";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { editTask } from "../../actions";
import type { EditTaskInput, TaskItem } from "../../task-input";
import { TASK_FIELD_NAMES, TASKS_COPY, type TaskField } from "../../tasks-copy";
import { failureReason, useTasksScreen, type TasksScreenValue } from "../tasks-screen";

// ── Shared by every section of the detail (T1 and the ones T2–T5 add) ─────────────────────────

export type TaskDetailValue = Pick<
  TasksScreenValue,
  "now" | "targets" | "enqueue" | "toaster" | "announce"
> & {
  /** The task as shown: the last one the server returned, with edits on their way on top. */
  task: TaskItem;
  /**
   * Where the detail is: `sheet` (desktop, over the list) or `page` (phone, /tasks/<id>). Sections
   * rarely care; deleting does (the sheet closes, the page goes back to the list).
   */
  host: "sheet" | "page";
  /** After the task is deleted (the host closes the sheet or leaves the page). */
  onDeleted: (task: TaskItem) => void;
  /**
   * Adopts a task the server returned (an action's `data`) as the new base of the view. Sections
   * that save through their own actions call it so every section shows the saved task.
   */
  adopt: (task: TaskItem) => void;
  /**
   * Says why something wasn't saved ("No se pudo guardar …; volvió a como estaba. <motivo>").
   * Sections use this, never `toaster.push`, for their failures: in the sheet the page behind is
   * aria-hidden and under it, so the message goes to an alert inside the sheet; on the page it is
   * a "Sin guardar" notice. A later successful save clears it. (`announce` follows the same
   * rule: inside the sheet while the detail is a sheet.)
   */
  reportError: (text: string) => void;
};

const TaskDetailContext = createContext<TaskDetailValue | null>(null);

/** The detail's task, host and the screen's queue, notices and announcer. */
export function useTaskDetail(): TaskDetailValue {
  const value = use(TaskDetailContext);
  if (!value) throw new Error("useTaskDetail must be used inside TaskDetailProvider");
  return value;
}

// ── The task's own fields (T1 sections: title, placement, due date, priority) ─────────────────

/** What the view shows at once while a save of the task's own fields is on its way. */
export type TaskPatch = Partial<
  Pick<
    TaskItem,
    "title" | "priority" | "dueDate" | "dueTime" | "lifeAreaId" | "projectId" | "milestoneId" | "area" | "project"
  >
>;

/**
 * Saves an edit of the task's own fields through `editTask`: shown at once, sent through the
 * screen's queue (key `task:<id>:<field>`, so a burst on one field sends the one in flight and
 * then the last), and rolled back with a "Sin guardar" notice if refused or the network fails.
 */
export type SaveTaskField = (
  field: TaskField,
  patch: TaskPatch,
  input: Omit<EditTaskInput, "id">,
  options?: { announceSaved?: boolean },
) => void;

const TaskFieldsContext = createContext<SaveTaskField | null>(null);

/** Save function for the task's own fields. Only inside `TaskDetailProvider`. */
export function useSaveTaskField(): SaveTaskField {
  const value = use(TaskFieldsContext);
  if (!value) throw new Error("useSaveTaskField must be used inside TaskDetailProvider");
  return value;
}

const applyPatch = (task: TaskItem, patch: TaskPatch): TaskItem => ({ ...task, ...patch });

type TaskDetailProviderProps = {
  task: TaskItem;
  host: TaskDetailValue["host"];
  onDeleted: TaskDetailValue["onDeleted"];
  children: React.ReactNode;
};

/**
 * State of a task's detail (inside a `TasksScreen`). Its base is the task it was opened with,
 * replaced by every answer of the server (and by a newer `task` prop: the page revalidates), so
 * the sheet keeps working even after the task leaves the list it was opened from (e.g. it was
 * moved out of the inbox).
 */
export function TaskDetailProvider({ task, host, onDeleted, children }: TaskDetailProviderProps) {
  const screen = useTasksScreen();
  const { enqueue, toaster } = screen;
  const { push } = toaster;
  const screenAnnounce = screen.announce;
  // Messages shown inside the sheet (see `reportError`); unused on the page.
  const [sheetStatus, announceInSheet] = useAnnouncer();
  const [sheetError, setSheetError] = useState<string | null>(null);
  const inSheet = host === "sheet";

  const announce = useCallback(
    (message: string) => {
      if (!inSheet) {
        screenAnnounce(message);
        return;
      }
      announceInSheet(message);
    },
    [announceInSheet, inSheet, screenAnnounce],
  );

  const reportError = useCallback(
    (text: string) => {
      if (inSheet) setSheetError(text);
      else push({ title: TASKS_COPY.notSavedTitle, text, tone: "error" });
    },
    [inSheet, push],
  );
  const [base, setBase] = useState(task);
  const [source, setSource] = useState(task);
  if (task !== source) {
    // A newer task from the server (revalidation): it becomes the base.
    setSource(task);
    setBase(task);
  }
  const [view, apply] = useOptimistic<TaskItem, TaskPatch>(base, applyPatch);
  const adopt = useCallback((saved: TaskItem) => setBase(saved), []);

  const saveField = useCallback<SaveTaskField>(
    (field, patch, input, options) => {
      const id = base.id;
      startTransition(async () => {
        apply(patch);
        const queued = await enqueue(`task:${id}:${field}`, () => editTask({ id, ...input }));
        if (queued.kind === "skipped" || queued.superseded) return;
        const what = TASK_FIELD_NAMES[field];
        if (queued.kind === "done" && queued.value.ok) {
          setBase(queued.value.data);
          setSheetError(null);
          if (options?.announceSaved) announce(TASKS_COPY.saved(what));
          return;
        }
        // A throw is a network failure or a new deployment: the actions themselves never throw.
        const reason =
          queued.kind === "threw"
            ? TASKS_COPY.checkConnection
            : failureReason(queued.value as Extract<ActionResult<TaskItem>, { ok: false }>);
        reportError(`${TASKS_COPY.notSaved(what)} ${reason}`);
      });
    },
    [apply, base.id, enqueue, reportError, announce],
  );

  const value = useMemo<TaskDetailValue>(
    () => ({
      task: view,
      host,
      onDeleted,
      adopt,
      now: screen.now,
      targets: screen.targets,
      enqueue,
      toaster,
      announce,
      reportError,
    }),
    [
      view,
      host,
      onDeleted,
      adopt,
      screen.now,
      screen.targets,
      enqueue,
      toaster,
      announce,
      reportError,
    ],
  );

  const messages = useMemo(
    () => ({ status: sheetStatus, error: sheetError, dismissError: () => setSheetError(null) }),
    [sheetStatus, sheetError],
  );

  return (
    <TaskDetailContext value={value}>
      <SheetMessagesContext value={messages}>
        <TaskFieldsContext value={saveField}>{children}</TaskFieldsContext>
      </SheetMessagesContext>
    </TaskDetailContext>
  );
}

// ── Messages inside the sheet ─────────────────────────────────────────────────────────────────

type SheetMessages = { status: string; error: string | null; dismissError: () => void };

const SheetMessagesContext = createContext<SheetMessages | null>(null);

/**
 * The detail's own polite status and error alert. The sheet host renders it inside the dialog
 * (the only part of the page a screen reader reads while it is open); the page host doesn't
 * need it (its messages go to the screen's announcer and notices).
 */
export function TaskDetailSheetMessages() {
  const messages = use(SheetMessagesContext);
  if (!messages) return null;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-detail-status="">
        {messages.status}
      </p>
      <div role="alert" data-detail-error="">
        {messages.error ? (
          <p className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {messages.error}
          </p>
        ) : null}
      </div>
    </>
  );
}
