"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { Icon, Key, TextField } from "@/design-system";
import { createTask } from "../../actions";
import type { MilestoneRef } from "../../project-task-groups";
import { PROJECT_TASKS_COPY } from "../../project-tasks-copy";
import { createTaskInputSchema } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { failureReason, useTasksScreen } from "../tasks-screen";

type ProjectTaskAddProps = {
  projectId: string;
  milestones: MilestoneRef[];
};

/**
 * Adds a task to the project inline (T5): "Nueva tarea" and, with milestones, "Hito" (optional;
 * it stays for the next ones). Enter adds it and leaves the field empty with the focus, ready for
 * another (like milestones). Not optimistic: the row arrives with the page's revalidation (the
 * server gives the task its id); a failure puts the text back and says why.
 */
export function ProjectTaskAdd({ projectId, milestones }: ProjectTaskAddProps) {
  const ids = useId();
  const fieldId = `${ids}-title`;
  const milestoneId = `${ids}-milestone`;
  const { enqueue, toaster, announce } = useTasksScreen();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [milestone, setMilestone] = useState("");
  const [saving, startSaving] = useTransition();
  // A milestone deleted meanwhile is no longer offered: back to "Sin hito".
  const chosen = milestones.some((item) => item.id === milestone) ? milestone : "";

  function add() {
    const parsed = createTaskInputSchema.safeParse({
      title: draft,
      projectId,
      milestoneId: chosen === "" ? null : chosen,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.find((issue) => issue.path[0] === "title")?.message);
      input.current?.focus();
      return;
    }
    const { title } = parsed.data;
    const where = milestones.find((item) => item.id === chosen)?.title ?? null;
    setDraft("");
    setError(undefined);
    // Enter adds another: the field stays under the cursor.
    input.current?.focus();
    startSaving(async () => {
      const queued = await enqueue(null, () => createTask(parsed.data));
      if (queued.kind === "skipped") return;
      if (queued.kind === "done" && queued.value.ok) {
        announce(where ? PROJECT_TASKS_COPY.addedTo(title, where) : PROJECT_TASKS_COPY.added(title));
        return;
      }
      // The text comes back to the field, unless something new was typed meanwhile.
      setDraft((current) => (current === "" ? title : current));
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<typeof queued.value, { ok: false }>);
      toaster.push({
        title: TASKS_COPY.notSavedTitle,
        text: `${PROJECT_TASKS_COPY.notAdded} ${reason}`,
        tone: "error",
      });
    });
  }

  return (
    <form
      noValidate
      aria-label={PROJECT_TASKS_COPY.addForm}
      className="flex flex-col gap-3"
      data-project-task-add=""
      data-saving={saving || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <TextField
        ref={input}
        id={fieldId}
        label={PROJECT_TASKS_COPY.addLabel}
        value={draft}
        autoComplete="off"
        enterKeyHint="enter"
        error={error}
        help={PROJECT_TASKS_COPY.addHelp}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
      />
      {milestones.length > 0 ? (
        <div className="bo-field">
          <label className="bo-field__label" htmlFor={milestoneId}>
            {PROJECT_TASKS_COPY.milestoneLabel}
          </label>
          <div className="bo-select">
            <select
              id={milestoneId}
              className="bo-field__control"
              value={chosen}
              aria-describedby={`${milestoneId}-help`}
              onChange={(event) => setMilestone(event.target.value)}
            >
              <option value="">{PROJECT_TASKS_COPY.noMilestone}</option>
              {milestones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
          </div>
          <span id={`${milestoneId}-help`} className="bo-field__help">
            {PROJECT_TASKS_COPY.milestoneHelp}
          </span>
        </div>
      ) : null}
      <Key type="submit" icon={Plus} className="self-start">
        {PROJECT_TASKS_COPY.add}
      </Key>
    </form>
  );
}
