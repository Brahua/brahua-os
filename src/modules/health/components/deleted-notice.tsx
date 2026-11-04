"use client";

import { useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { restoreExercise } from "../exercises-actions";
import { EXERCISES_COPY } from "../exercises-copy";
import { HEALTH_COPY as COPY } from "../health-copy";
import { DELETED_PARAM } from "../routes";
import { restoreRoutine } from "../routines-actions";
import { ROUTINES_COPY } from "../routines-copy";
import { failureReason, useHealthSave } from "./use-health-save";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type DeletedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** What was just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: { id: string; name: string } | null;
  /** «Deshacer». */
  restore: (input: { id: string }) => Promise<ActionResult<unknown>>;
  title: string;
  text: (name: string) => string;
  restored: (name: string) => string;
};

/**
 * After deleting a routine or an exercise from its page, the page sends to the list with
 * `?deleted=<id>`: focus goes to the heading, the parameter leaves the URL (a reload doesn't
 * repeat it) and «… eliminado · Deshacer» shows in the screen's notices (as in `learning`).
 */
function DeletedNotice({ headingId, deleted, restore, title, text, restored }: DeletedNoticeProps) {
  const { send, toaster } = useHealthSave();
  const { push } = toaster;
  const shown = useRef<string | null>(null);
  // The copy functions are module constants, but a caller could pass new ones on each render.
  const copy = useRef({ title, text, restored, restore });
  useEffect(() => {
    copy.current = { title, text, restored, restore };
  });

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const target = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    async function undo() {
      const result = await send(() => copy.current.restore({ id: target.id }));
      if (result.ok) {
        push({ title: COPY.undoneTitle, text: copy.current.restored(target.name) });
        return;
      }
      push({
        title: COPY.notSavedTitle,
        text: `${COPY.notUndone} ${failureReason(result)}`,
        tone: "error",
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = target.id;
      push({
        title: copy.current.title,
        text: copy.current.text(target.name),
        action: { label: COPY.undo, run: () => void undo() },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, send]);

  return null;
}

type Deleted = { headingId: string; deleted: { id: string; name: string } | null };

/** /health after deleting a routine from its page: «Rutina eliminada · Deshacer». */
export function RoutineDeletedNotice(props: Deleted) {
  return (
    <DeletedNotice
      {...props}
      restore={restoreRoutine}
      title={ROUTINES_COPY.deletedTitle}
      text={ROUTINES_COPY.deleted}
      restored={ROUTINES_COPY.restored}
    />
  );
}

/** The catalogue after deleting an exercise from its page: «Ejercicio eliminado · Deshacer». */
export function ExerciseDeletedNotice(props: Deleted) {
  return (
    <DeletedNotice
      {...props}
      restore={restoreExercise}
      title={EXERCISES_COPY.deletedTitle}
      text={EXERCISES_COPY.deleted}
      restored={EXERCISES_COPY.restored}
    />
  );
}
