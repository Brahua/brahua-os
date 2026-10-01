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
import type { ActionResult } from "@/lib/action-result";
import { useToaster, type Toaster } from "@/lib/toast/use-toaster";
import { useSaveQueue, type Enqueue } from "@/lib/use-save-queue";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import type { ProjectDetail } from "@/modules/projects/project-input";
import { applyProjectChange, type ProjectPatch } from "@/modules/projects/project-optimistic";
import {
  PROJECT_FIELD_NAMES,
  PROJECTS_COPY,
  type ProjectField,
} from "@/modules/projects/projects-copy";

// ── Shared by every section (P2 and the ones P3–P5 add) ────────────────────────────────────────

export type ProjectDetailValue = {
  /** The project as shown: the server's, with any edit of its own fields still on its way. */
  project: ProjectDetail;
  /** The instant the page was rendered: due notices count Lima days from it. */
  now: Date;
  /**
   * The page's one save queue (src/lib/use-save-queue.ts): calls run in order, and a call whose
   * turn comes after a newer one with the same key is skipped. Each section uses its own keys
   * (e.g. `milestone:<id>`) and keeps its own useOptimistic; call it inside startTransition.
   */
  enqueue: Enqueue;
  /** The page's notice queue (one viewport per screen): "Deshacer" and "Sin guardar" notices. */
  toaster: Toaster;
  /** Says something politely to screen readers (e.g. "Se guardó el nombre."). */
  announce: (message: string) => void;
};

const ProjectDetailContext = createContext<ProjectDetailValue | null>(null);

/** The page's project, save queue, notices and announcer. Only inside `ProjectDetailProvider`. */
export function useProjectDetail(): ProjectDetailValue {
  const value = use(ProjectDetailContext);
  if (!value) throw new Error("useProjectDetail must be used inside ProjectDetailProvider");
  return value;
}

// ── The project's own fields (P2 sections only) ────────────────────────────────────────────────

/**
 * Saves an edit of the project's own fields (name, state, priority, area, objective, dates):
 * shown at once in every section, then sent through the queue (key `project:<field>`).
 */
export type SaveProjectField = (
  field: ProjectField,
  patch: ProjectPatch,
  call: () => Promise<ActionResult<unknown>>,
  options?: { announceSaved?: boolean },
) => void;

const ProjectFieldsContext = createContext<SaveProjectField | null>(null);

/** Save function for the project's own fields. Only inside `ProjectDetailProvider`. */
export function useSaveProjectField(): SaveProjectField {
  const value = use(ProjectFieldsContext);
  if (!value) throw new Error("useSaveProjectField must be used inside ProjectDetailProvider");
  return value;
}

/** The server's message for the field when it gives one, else its general one. */
function failureReason(result: ActionResult<unknown>): string {
  if (result.ok) return "";
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

type ProjectDetailProviderProps = {
  project: ProjectDetail;
  now: Date;
  children: React.ReactNode;
};

/**
 * State of a project's page. An edit of the project's own fields shows at once in every section
 * (useOptimistic: the state changes the due notice in the header, for one) and is saved in the
 * background; the server stays the source of truth: its answer (the page revalidates) replaces
 * the optimistic view, and a refusal or a network failure rolls it back with a notice.
 *
 * Quick changes to one field collapse (see useSaveQueue). A failure of a save that a newer one of
 * the same field superseded says nothing: the newer one decides what stays.
 */
export function ProjectDetailProvider({ project, now, children }: ProjectDetailProviderProps) {
  const [view, applyChange] = useOptimistic(project, applyProjectChange);
  const toaster = useToaster();
  const { push } = toaster;
  const enqueue = useSaveQueue();
  const [announcement, setAnnouncement] = useState("");

  const announce = useCallback((message: string) => {
    // Cleared first, so the same message twice is read twice.
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(message), 50);
  }, []);

  const saveField = useCallback<SaveProjectField>(
    (field, patch, call, options) => {
      startTransition(async () => {
        applyChange({ patch, at: new Date() });
        const queued = await enqueue(`project:${field}`, call);
        if (queued.kind === "skipped" || queued.superseded) return;
        const what = PROJECT_FIELD_NAMES[field];
        if (queued.kind === "done" && queued.value.ok) {
          if (options?.announceSaved) announce(PROJECTS_COPY.saved(what));
          return;
        }
        // A throw is a network failure or a new deployment: the actions themselves never throw.
        const reason =
          queued.kind === "threw" ? PROJECTS_COPY.checkConnection : failureReason(queued.value);
        push({
          title: PROJECTS_COPY.notSavedTitle,
          text: `${PROJECTS_COPY.notSaved(what)} ${reason}`,
          tone: "error",
        });
      });
    },
    [applyChange, enqueue, push, announce],
  );

  const value = useMemo<ProjectDetailValue>(
    () => ({ project: view, now, enqueue, toaster, announce }),
    [view, now, enqueue, toaster, announce],
  );

  return (
    <ProjectDetailContext value={value}>
      <ProjectFieldsContext value={saveField}>{children}</ProjectFieldsContext>
      <p role="status" aria-live="polite" className="sr-only" data-detail-announcer>
        {announcement}
      </p>
      <ToastViewport
        toaster={toaster}
        label={PROJECTS_COPY.noticesLabel}
        actionHint={PROJECTS_COPY.undoHint}
      />
    </ProjectDetailContext>
  );
}
