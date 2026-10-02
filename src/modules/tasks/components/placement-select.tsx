"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";
import { INBOX_VALUE, placementOptions, type PlacementValue } from "../placement";
import type { TaskItem, TaskTargets } from "../task-input";
import { TASKS_COPY } from "../tasks-copy";

type PlacementSelectProps = {
  id: string;
  /** null while loading (only the inbox is offered). */
  targets: TaskTargets | null;
  value: PlacementValue;
  onValueChange: (value: PlacementValue) => void;
  /** The task being edited: its current area or project stays listed (archived or closed). */
  current?: Pick<TaskItem, "lifeAreaId" | "projectId" | "area" | "project"> | null;
  /** Under the field, unless there is an error. */
  help?: string;
  error?: string;
  className?: string;
  ref?: React.Ref<HTMLSelectElement>;
};

/**
 * "Área o proyecto": one native select with the inbox first, then the active areas and the open
 * projects in two groups. Native on purpose: on the phone it is the system's wheel (one tap and
 * a flick, the fastest way to pick among 8+ areas and the projects), and it is a single tab stop
 * with type-ahead on the desktop.
 */
export function PlacementSelect({
  id,
  targets,
  value,
  onValueChange,
  current,
  help,
  error,
  className,
  ref,
}: PlacementSelectProps) {
  const { areas, projects } = placementOptions(targets, current);
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className={cn("bo-field", error && "is-error", className)}>
      <label className="bo-field__label" htmlFor={id}>
        {TASKS_COPY.placementLabel}
      </label>
      <div className="bo-select">
        <select
          ref={ref}
          id={id}
          className="bo-field__control"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onValueChange(event.target.value)}
        >
          <option value={INBOX_VALUE}>{TASKS_COPY.placementInbox}</option>
          {areas.length > 0 ? (
            <optgroup label={TASKS_COPY.placementAreas}>
              {areas.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {projects.length > 0 ? (
            <optgroup label={TASKS_COPY.placementProjects}>
              {projects.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
      </div>
      {error ? (
        <span id={`${id}-error`} className="bo-field__error">
          <Icon icon={TriangleAlert} size="sm" />
          {error}
        </span>
      ) : help ? (
        <span id={`${id}-help`} className="bo-field__help">
          {help}
        </span>
      ) : null}
    </div>
  );
}
