"use client";

import { startTransition, useId, useOptimistic, useTransition } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { NEXT_ACTION_COPY } from "../next-action-copy";
import type { NextActionCall, NextActionUndoCall } from "../project-extensions";
import { PROJECTS_COPY } from "../projects-copy";

type NextActionKeyProps = {
  projectName: string;
  action: { id: string; title: string };
  /** The source's Server Actions (T5: `tasks`): complete it, and the notice's "Deshacer". */
  complete: NextActionCall;
  undoComplete: NextActionUndoCall;
};

function reasonOf(result: ActionResult<unknown>): string {
  if (result.ok) return "";
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/**
 * "SIGUIENTE TAREA" on a project's card (Claude Design pattern `ProjectCard`): the project's next
 * action, with a check that completes it in one tap. Optimistic: the key leaves at once and a
 * notice says "«X» está hecha." with "Deshacer" (pending again and the next action again). Above
 * the card's link overlay, so the check gets the tap. Uses the list's queue and notices.
 */
export function NextActionKey({ projectName, action, complete, undoComplete }: NextActionKeyProps) {
  const ids = useId();
  const { enqueue, toaster, announce } = useRequiredScreenServices();
  const [hidden, setHidden] = useOptimistic(false);
  const [saving, startSaving] = useTransition();

  function check(event: React.ChangeEvent<HTMLInputElement>) {
    // The key leaves: focus goes to the card's name (never to <body>).
    if (document.activeElement === event.currentTarget) {
      event.currentTarget.closest("[data-project-card]")?.querySelector<HTMLElement>("a")?.focus();
    }
    startSaving(async () => {
      setHidden(true);
      const queued = await enqueue(`next-action-done:${action.id}`, () =>
        complete({ id: action.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(PROJECTS_COPY.checkConnection);
      if (result.ok) {
        toaster.push({
          title: NEXT_ACTION_COPY.completedTitle,
          text: NEXT_ACTION_COPY.completed(action.title),
          action: { label: PROJECTS_COPY.undo, run: undo },
        });
        return;
      }
      toaster.push({
        title: PROJECTS_COPY.notSavedTitle,
        text: `${NEXT_ACTION_COPY.notCompleted} ${reasonOf(result)}`,
        tone: "error",
      });
    });
  }

  function undo() {
    // The plain startTransition: by now the key has usually left the card (the list revalidated
    // without it), and the notice outlives it.
    startTransition(async () => {
      const queued = await enqueue(`next-action-done:${action.id}`, () =>
        undoComplete({ id: action.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(PROJECTS_COPY.checkConnection);
      if (result.ok && result.data.warning) {
        // Pending again, but it couldn't be the next action again (e.g. the project closed).
        toaster.push({
          title: PROJECTS_COPY.notSavedTitle,
          text: `${NEXT_ACTION_COPY.reopened(action.title)} ${result.data.warning}`,
          tone: "error",
        });
      } else if (result.ok) {
        // Another task got the mark meanwhile: it keeps it, and this one is only pending again.
        announce(
          result.data.restored
            ? NEXT_ACTION_COPY.undone(action.title)
            : NEXT_ACTION_COPY.pendingAgain(action.title),
        );
      } else
        toaster.push({
          title: PROJECTS_COPY.notSavedTitle,
          text: `${NEXT_ACTION_COPY.notUndone} ${reasonOf(result)}`,
          tone: "error",
        });
    });
  }

  if (hidden) return null;
  return (
    // relative z-10: above the name link's overlay (`after:inset-0`), so the check gets the tap.
    <div
      className="bo-next-action relative z-10"
      data-next-action={action.id}
      data-saving={saving || undefined}
    >
      {/* A label: the whole 44 px square toggles the 20 px checkbox. */}
      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className="bo-milestone-check"
          checked={false}
          aria-label={NEXT_ACTION_COPY.check(action.title)}
          aria-describedby={`${ids}-of`}
          onChange={check}
        />
      </label>
      <div className="flex min-w-0 flex-col gap-0.5 py-1.5 pr-3">
        <span className="bo-text-label text-text-secondary" aria-hidden>
          {NEXT_ACTION_COPY.label}
        </span>
        <span className="bo-text-body-sm break-words" aria-hidden>
          {action.title}
        </span>
        <span id={`${ids}-of`} hidden>
          {NEXT_ACTION_COPY.checkDescription(projectName)}
        </span>
      </div>
    </div>
  );
}
