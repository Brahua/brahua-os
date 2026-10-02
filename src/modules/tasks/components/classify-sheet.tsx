"use client";

import { Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Key, Sheet } from "@/design-system";
import { fail } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { placementValue, toPlacement, type PlacementValue } from "../placement";
import { editTaskInputSchema, type TaskItem, type TaskTargets } from "../task-input";
import { TASKS_COPY } from "../tasks-copy";
import { DateField } from "./date-field";
import { PlacementSelect } from "./placement-select";

export type ClassifySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskItem;
  targets: TaskTargets;
  /** Where focus goes on close (the row's key, or a neighbor if the row is leaving). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Called once the sheet has fully closed (announce results here). */
  onClosed?: () => void;
  /** "Guardar": the list applies it at once and saves it in the background. */
  onSave: (task: TaskItem, placement: PlacementValue, dueDate: string | null) => void;
  /** "Eliminar tarea" (GTD: classify it or delete it). */
  onDelete: (task: TaskItem) => void;
};

/**
 * The inbox's quick action (SPEC-tasks "Bandeja"): where the task goes (area or project) and,
 * if needed, a due date, in one sheet with the picker focused. "Guardar" closes it at once (the
 * list is optimistic and offers "Deshacer"); "Eliminar tarea" is the other way out of the inbox.
 */
export function ClassifySheet({
  open,
  onOpenChange,
  task,
  targets,
  returnFocusRef,
  onClosed,
  onSave,
  onDelete,
}: ClassifySheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const [placement, setPlacement] = useState<PlacementValue>(placementValue(task));
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [dueError, setDueError] = useState<string | undefined>();
  const placementSelect = useRef<HTMLSelectElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = editTaskInputSchema.safeParse({
      id: task.id,
      placement: toPlacement(placement, task),
      dueDate,
    });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      const message = failed.ok ? undefined : failed.fieldErrors?.dueDate?.[0];
      setDueError(message ?? TASKS_COPY.unexpected);
      dueInput.current?.focus();
      return;
    }
    onSave(task, placement, parsed.data.dueDate ?? null);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={TASKS_COPY.classifyTitle}
      description={TASKS_COPY.classifyDescription(task.title)}
      returnFocusRef={returnFocusRef}
      // On the phone the picker would open the system wheel at once: focus the title instead.
      initialFocusRef={isDesktop ? placementSelect : undefined}
      focusTitleOnOpen={!isDesktop}
      onClosed={onClosed}
      footer={
        <>
          <Key variant="ghost" className="flex-1 lg:flex-none" onClick={() => onOpenChange(false)}>
            {TASKS_COPY.cancel}
          </Key>
          <Key type="submit" form={formId} variant="signal" className="flex-1">
            {TASKS_COPY.save}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
        <PlacementSelect
          ref={placementSelect}
          id={`${ids}-placement`}
          targets={targets}
          current={task}
          value={placement}
          onValueChange={setPlacement}
        />
        <DateField
          ref={dueInput}
          id={`${ids}-due`}
          label={TASKS_COPY.dueLabel}
          value={dueDate}
          help={TASKS_COPY.dueHelp}
          error={dueError}
          onChange={(event) => {
            setDueDate(event.target.value);
            setDueError(undefined);
          }}
        />
        <div className="flex flex-col items-start gap-2 border-t border-divider pt-5">
          <Key
            variant="ghost"
            icon={Trash2}
            aria-describedby={`${ids}-delete-help`}
            onClick={() => onDelete(task)}
          >
            {TASKS_COPY.deleteTask}
          </Key>
          <p id={`${ids}-delete-help`} className="bo-text-body-sm text-text-secondary">
            {TASKS_COPY.deleteHelp}
          </p>
        </div>
      </form>
    </Sheet>
  );
}
