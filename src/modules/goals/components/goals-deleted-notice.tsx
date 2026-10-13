"use client";

import { startTransition, useEffect, useRef } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { restoreGoal } from "../actions";
import type { DeletedGoal, GoalItem } from "../goal-input";
import { GOALS_COPY } from "../goals-copy";
import { DELETED_PARAM } from "../routes";
import { failureReason, useGoalsScreen } from "./goals-screen";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type GoalsDeletedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The goal just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedGoal | null;
};

/**
 * After deleting a goal from its page, the page sends here with `?deleted=<id>`: focus goes to
 * the heading, the parameter leaves the URL (a reload doesn't repeat it) and "Meta eliminada ·
 * Deshacer" shows in the screen's notices. "Deshacer" restores it (back in its place, with its
 * entries; the page's revalidation brings its row).
 */
export function GoalsDeletedNotice({ headingId, deleted }: GoalsDeletedNoticeProps) {
  const { toaster, announce } = useGoalsScreen();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const goal = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    function undo() {
      startTransition(async () => {
        let result: ActionResult<GoalItem>;
        try {
          result = await restoreGoal({ id: goal.id });
        } catch {
          result = fail(GOALS_COPY.checkConnection);
        }
        if (result.ok) announce(GOALS_COPY.restored(goal.title));
        else {
          push({
            title: GOALS_COPY.notSavedTitle,
            text: `${GOALS_COPY.notUndone} ${failureReason(result)}`,
            tone: "error",
          });
        }
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = goal.id;
      push({
        title: GOALS_COPY.deletedTitle,
        text: GOALS_COPY.deleted(goal.title),
        action: { label: GOALS_COPY.undo, run: undo },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, announce]);

  return null;
}
