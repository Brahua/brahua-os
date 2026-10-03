"use client";

import { startTransition, useEffect, useRef } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { restoreHabit } from "../actions";
import type { DeletedHabit, HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { DELETED_PARAM } from "../routes";
import { failureReason, useHabitsScreen } from "./habits-screen";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type HabitsDeletedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The habit just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedHabit | null;
};

/**
 * H5: after deleting a habit from its page, the page sends here with `?deleted=<id>` (like
 * tasks): focus goes to the heading, the parameter leaves the URL (a reload doesn't repeat it) and
 * "Hábito eliminado · Deshacer" shows in the screen's notices. "Deshacer" restores it (back in
 * its place, with its logs; the page's revalidation brings its pad).
 */
export function HabitsDeletedNotice({ headingId, deleted }: HabitsDeletedNoticeProps) {
  const { toaster, announce } = useHabitsScreen();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const habit = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    function undo() {
      startTransition(async () => {
        let result: ActionResult<HabitItem>;
        try {
          result = await restoreHabit({ id: habit.id });
        } catch {
          result = fail(HABITS_COPY.checkConnection);
        }
        if (result.ok) announce(HABITS_COPY.restored(habit.name));
        else {
          push({
            title: HABITS_COPY.notSavedTitle,
            text: `${HABITS_COPY.notUndone} ${failureReason(result)}`,
            tone: "error",
          });
        }
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = habit.id;
      push({
        title: HABITS_COPY.deletedTitle,
        text: HABITS_COPY.deleted(habit.name),
        action: { label: HABITS_COPY.undo, run: undo },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, announce]);

  return null;
}
