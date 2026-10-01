"use client";

import { startTransition, useEffect, useRef } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useToaster } from "@/lib/toast/use-toaster";
import { ToastViewport } from "@/modules/core/components/toast-viewport";
import { restoreProject } from "@/modules/projects/actions";
import type { DeletedProject, ProjectSummary } from "@/modules/projects/project-input";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { DELETED_PARAM } from "@/modules/projects/routes";

/** A live region only speaks what changes after it is on the page (see CreatedNotice). */
const ANNOUNCE_DELAY_MS = 150;

type ProjectsNoticesProps = {
  /** Id of the list's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The project just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedProject | null;
};

/**
 * The list's notices. Always on the page, so the queue survives the list re-rendering (the
 * filter, or the revalidation after "Deshacer").
 *
 * After deleting a project its page sends here with `?deleted=<id>`: focus goes to the heading
 * (the delete key is gone), the parameter leaves the URL so a reload doesn't repeat it, and
 * "Proyecto eliminado · Deshacer" shows with the C6 rules (10 s, paused on hover or focus,
 * ⌘Z / Ctrl+Z). "Deshacer" restores it and the list brings it back.
 */
export function ProjectsNotices({ headingId, deleted }: ProjectsNoticesProps) {
  const toaster = useToaster();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const project = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    function undo() {
      startTransition(async () => {
        let result: ActionResult<ProjectSummary>;
        try {
          result = await restoreProject({ id: project.id });
        } catch {
          result = fail(PROJECTS_COPY.undoFailed);
        }
        if (result.ok) {
          push({
            title: PROJECTS_COPY.undoneTitle,
            text: PROJECTS_COPY.restored(result.data.name),
          });
        } else {
          push({
            title: PROJECTS_COPY.notSavedTitle,
            text: PROJECTS_COPY.undoFailed,
            tone: "error",
          });
        }
      });
    }

    const timer = window.setTimeout(() => {
      // Marked here, not before: an effect that is cleaned up and run again still shows it once.
      shown.current = project.id;
      push({
        title: PROJECTS_COPY.deletedTitle,
        text: PROJECTS_COPY.deleted(project.name),
        action: { label: PROJECTS_COPY.undo, run: undo },
        // Stays until dismissed ("Deshacer", Esc) or the list goes away: deleting is the one
        // change here that can't be redone by hand.
        duration: Number.POSITIVE_INFINITY,
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push]);

  return (
    <ToastViewport
      toaster={toaster}
      label={PROJECTS_COPY.noticesLabel}
      actionHint={PROJECTS_COPY.undoHint}
    />
  );
}
