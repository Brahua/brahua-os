"use client";

import { useId } from "react";
import { SectionLabel, SegmentedControl, type SegmentOption } from "@/design-system";
import { RadioGrid, type RadioGridOption } from "@/modules/core/components/radio-grid";
import { changeProjectPriority, changeProjectStatus } from "@/modules/projects/actions";
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type ProjectPriority,
  type ProjectStatus,
} from "@/modules/projects/project-constants";
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECTS_COPY,
} from "@/modules/projects/projects-copy";
import { useProjectDetail } from "./project-detail-context";

const STATUS_OPTIONS: RadioGridOption<ProjectStatus>[] = PROJECT_STATUSES.map((status) => ({
  value: status,
  label: PROJECT_STATUS_LABELS[status],
  children: <span className="bo-option-key__label">{PROJECT_STATUS_LABELS[status]}</span>,
}));

const PRIORITY_OPTIONS: SegmentOption<ProjectPriority>[] = PROJECT_PRIORITIES.map((priority) => ({
  value: priority,
  label: PROJECT_PRIORITY_LABELS[priority],
}));

/**
 * State and priority, both saved the moment they change (optimistic; a refusal rolls back with
 * a notice). The six states are a radio group of keys: one tab stop, arrows move and pick.
 */
export function ProjectStateSection() {
  const { project, save } = useProjectDetail();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const statusLabelId = `${ids}-status`;
  const statusHelpId = `${ids}-status-help`;

  function changeStatus(status: ProjectStatus) {
    if (status === project.status) return;
    save("status", { status }, () => changeProjectStatus({ id: project.id, status }));
  }

  function changePriority(priority: ProjectPriority) {
    if (priority === project.priority) return;
    save("priority", { priority }, () => changeProjectPriority({ id: project.id, priority }));
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel id={headingId} as="h2" title={PROJECTS_COPY.stateSection} />
      <div className="bo-card gap-6">
        <div className="bo-field">
          <span id={statusLabelId} className="bo-field__label">
            {PROJECTS_COPY.statusLabel}
          </span>
          <RadioGrid
            options={STATUS_OPTIONS}
            value={project.status}
            onValueChange={changeStatus}
            labelledBy={statusLabelId}
            describedBy={statusHelpId}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            itemClassName="bo-option-key min-w-0"
          />
          <span id={statusHelpId} className="bo-field__help">
            {PROJECTS_COPY.statusHelp}
          </span>
        </div>
        <div className="bo-field">
          <span className="bo-field__label" aria-hidden>
            {PROJECTS_COPY.priorityLabel}
          </span>
          <SegmentedControl
            mode="radio"
            touch
            label={PROJECTS_COPY.priorityLabel}
            options={PRIORITY_OPTIONS}
            value={project.priority}
            onValueChange={changePriority}
            className="w-full sm:w-fit"
          />
        </div>
      </div>
    </section>
  );
}
