"use client";

import { useId, useState } from "react";
import { TextField } from "@/design-system";
import { editTaskInputSchema } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { useSaveTaskField, useTaskDetail } from "./task-detail-context";

const titleSchema = editTaskInputSchema.shape.title.unwrap();

/**
 * The title, always editable: Enter or leaving the field saves it (when it changed and is
 * valid); an invalid title stays in the field with its error and nothing is sent.
 */
export function TaskTitleSection() {
  const { task } = useTaskDetail();
  const save = useSaveTaskField();
  const ids = useId();
  const [draft, setDraft] = useState(task.title);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  // While not editing, the field follows the task (a save elsewhere, a revalidation).
  const shown = editing ? draft : task.title;

  function commit() {
    setEditing(false);
    const parsed = titleSchema.safeParse(draft);
    if (!parsed.success) {
      setEditing(true);
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    if (parsed.data === task.title) return;
    save("title", { title: parsed.data }, { title: parsed.data }, { announceSaved: true });
  }

  return (
    <TextField
      id={`${ids}-title`}
      label={TASKS_COPY.titleLabel}
      value={shown}
      autoComplete="off"
      enterKeyHint="done"
      required
      error={error}
      help={TASKS_COPY.titleHelp}
      onFocus={() => {
        if (!editing) setDraft(task.title);
        setEditing(true);
      }}
      onChange={(event) => {
        setEditing(true);
        setDraft(event.target.value);
        if (error) setError(undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          commit();
        }
      }}
      onBlur={() => {
        if (editing) commit();
      }}
    />
  );
}
