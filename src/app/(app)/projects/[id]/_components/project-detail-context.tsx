"use client";

import {
  createContext,
  startTransition,
  use,
  useCallback,
  useMemo,
  useOptimistic,
  useRef,
} from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import { applyProjectChange, type ProjectPatch } from "@/modules/projects/project-optimistic";
import type { ProjectSummary } from "@/modules/projects/project-input";
import {
  PROJECT_FIELD_NAMES,
  PROJECTS_COPY,
  type ProjectField,
} from "@/modules/projects/projects-copy";

/** Saves one in-place edit: shown at once, then sent to the server. */
export type SaveProjectEdit = (
  field: ProjectField,
  patch: ProjectPatch,
  call: () => Promise<ActionResult<unknown>>,
) => void;

export type ProjectDetailValue = {
  /** The project as shown: the server's, with any edit still on its way applied on top. */
  project: ProjectSummary;
  /** The instant the page was rendered: due notices count Lima days from it. */
  now: Date;
  save: SaveProjectEdit;
  /**
   * The page's notice queue (one viewport per screen, see src/lib/toast/queue.ts). Sections
   * added later (milestones, links) push their "Deshacer" notices here.
   */
  toaster: Toaster;
};

const ProjectDetailContext = createContext<ProjectDetailValue | null>(null);

/** The detail's project, save function and notices. Only inside `ProjectDetailProvider`. */
export function useProjectDetail(): ProjectDetailValue {
  const value = use(ProjectDetailContext);
  if (!value) throw new Error("useProjectDetail must be used inside ProjectDetailProvider");
  return value;
}

/** The server's message for the field when it gives one, else its general one. */
function failureText(result: ActionResult<unknown>): string {
  if (result.ok) return "";
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

type ProjectDetailProviderProps = {
  project: ProjectSummary;
  now: Date;
  children: React.ReactNode;
};

/**
 * State of a project's page. Every edit shows at once (useOptimistic) and is saved in the
 * background; the server stays the source of truth: its answer (the page revalidates) replaces
 * the optimistic view, and a refusal or a network failure rolls it back with a notice.
 *
 * Saves run one after another in the order they were made. Quick changes to one field (arrowing
 * through the states) collapse: a save that hasn't started when a newer one for the same field
 * arrives is skipped, so only the last value is sent after the one in flight.
 */
export function ProjectDetailProvider({ project, now, children }: ProjectDetailProviderProps) {
  const [view, applyChange] = useOptimistic(project, applyProjectChange);
  const toaster = useToaster();
  const { push } = toaster;
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  // The newest edit of each field: older ones that haven't started are skipped.
  const newest = useRef<Partial<Record<ProjectField, number>>>({});
  const serial = useRef(0);

  const save = useCallback<SaveProjectEdit>(
    (field, patch, call) => {
      const mine = ++serial.current;
      newest.current[field] = mine;
      startTransition(async () => {
        applyChange({ patch, at: new Date() });
        const run = saves.current.then(() => (newest.current[field] === mine ? call() : null));
        saves.current = run.catch(() => undefined);
        let result: ActionResult<unknown> | null;
        try {
          result = await run;
        } catch {
          // Network failure or a new deployment: the actions themselves never throw.
          result = fail(PROJECTS_COPY.notSaved(PROJECT_FIELD_NAMES[field]));
        }
        // Skipped, saved, or superseded by a newer edit of the same field (which decides).
        if (result === null || result.ok || newest.current[field] !== mine) return;
        push({ title: PROJECTS_COPY.notSavedTitle, text: failureText(result), tone: "error" });
      });
    },
    [applyChange, push],
  );

  const value = useMemo<ProjectDetailValue>(
    () => ({ project: view, now, save, toaster }),
    [view, now, save, toaster],
  );

  return (
    <ProjectDetailContext value={value}>
      {children}
      <ToastViewport
        toaster={toaster}
        label={PROJECTS_COPY.noticesLabel}
        actionHint={PROJECTS_COPY.undoHint}
      />
    </ProjectDetailContext>
  );
}
