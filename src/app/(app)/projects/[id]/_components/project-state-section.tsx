"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SectionLabel, SegmentedControl, type SegmentOption } from "@/design-system";
import { RadioGrid, type RadioGridOption } from "@/modules/core/components/radio-grid";
import { PriorityLed } from "@/modules/projects/components/priority-led";
import { changeProjectPriority, changeProjectStatus } from "@/modules/projects/actions";
import { isClosed, OPEN_STATUSES } from "@/modules/projects/project-close";
import {
  PROJECT_PRIORITIES,
  type ProjectPriority,
  type ProjectStatus,
} from "@/modules/projects/project-constants";
import {
  CLOSE_COPY,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECTS_COPY,
} from "@/modules/projects/projects-copy";
import { useProjectDetail, useSaveProjectField } from "./project-detail-context";

/**
 * How long the arrow keys must rest before the state they landed on is saved: browsing from Idea
 * to Mantenimiento shouldn't save (and revalidate) every state on the way.
 */
export const STATUS_SETTLE_MS = 500;

// Only the open states: Terminado and Cancelado are "Cerrar proyecto" (a confirmed action).
const STATUS_OPTIONS: RadioGridOption<ProjectStatus>[] = OPEN_STATUSES.map((status) => ({
  value: status,
  label: PROJECT_STATUS_LABELS[status],
  children: <span className="bo-option-key__label">{PROJECT_STATUS_LABELS[status]}</span>,
}));

// Moved to the module so tasks share it; re-exported for the existing imports.
export { PriorityLed };

const PRIORITY_OPTIONS: SegmentOption<ProjectPriority>[] = PROJECT_PRIORITIES.map((priority) => ({
  value: priority,
  label: (
    <>
      <PriorityLed priority={priority} />
      {PROJECT_PRIORITY_LABELS[priority]}
    </>
  ),
}));

/**
 * State and priority (optimistic; a refusal rolls back with a notice). The four open states are a
 * radio group of keys: one tab stop, arrows move and pick. A click or tap saves at once; with the
 * arrows the pick shows at once but is saved once they rest (STATUS_SETTLE_MS), when focus
 * leaves the group, or when the page goes away. Terminado and Cancelado are "Cerrar proyecto"
 * (ProjectCloseSection); a closed project shows its state here as text.
 */
export function ProjectStateSection() {
  const { project } = useProjectDetail();
  const save = useSaveProjectField();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const statusLabelId = `${ids}-status`;
  const statusHelpId = `${ids}-status-help`;
  const closed = isClosed(project.status);

  // The state the arrow keys are on, not saved yet (null: nothing pending).
  const [browsing, setBrowsing] = useState<ProjectStatus | null>(null);
  const pending = useRef<ProjectStatus | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // What the last render showed, for the timer and the unmount (they outlive their render).
  const latest = useRef({ id: project.id, status: project.status });
  useEffect(() => {
    latest.current = { id: project.id, status: project.status };
  });

  function commitStatus(status: ProjectStatus) {
    window.clearTimeout(timer.current);
    pending.current = null;
    setBrowsing(null);
    if (status === latest.current.status) return;
    const id = latest.current.id;
    save("status", { status }, () => changeProjectStatus({ id, status }));
  }

  function flushStatus() {
    if (pending.current) commitStatus(pending.current);
  }

  function changeStatus(status: ProjectStatus, source: "keyboard" | "pointer") {
    if (source === "pointer") {
      commitStatus(status);
      return;
    }
    pending.current = status;
    setBrowsing(status);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commitStatus(status), STATUS_SETTLE_MS);
  }

  // Leaving the page with a pick still resting: save it anyway (no optimistic view to keep).
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const status = pending.current;
      const current = latest.current;
      if (status && status !== current.status) {
        void changeProjectStatus({ id: current.id, status }).catch(() => undefined);
      }
    },
    [],
  );

  function changePriority(priority: ProjectPriority) {
    if (priority === project.priority) return;
    save("priority", { priority }, () => changeProjectPriority({ id: project.id, priority }));
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel id={headingId} as="h2" title={PROJECTS_COPY.stateSection} />
      <div className="bo-card gap-6">
        <div
          className="bo-field"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flushStatus();
          }}
        >
          <span id={statusLabelId} className="bo-field__label">
            {PROJECTS_COPY.statusLabel}
          </span>
          {closed ? (
            // Closed: no picker (none of its options would be on); "Reabrir" is further down.
            <p className="bo-text-body-sm" data-closed-status>
              {CLOSE_COPY.closedStatus(PROJECT_STATUS_LABELS[project.status])}
            </p>
          ) : (
            <>
              <RadioGrid
                options={STATUS_OPTIONS}
                value={browsing ?? project.status}
                onValueChange={changeStatus}
                labelledBy={statusLabelId}
                describedBy={statusHelpId}
                className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-4"
                itemClassName="bo-option-key min-w-0"
              />
              <span id={statusHelpId} className="bo-field__help">
                {PROJECTS_COPY.statusHelp}
              </span>
            </>
          )}
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
