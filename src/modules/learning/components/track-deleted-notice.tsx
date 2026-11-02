"use client";

import { useEffect, useRef } from "react";
import { LEARNING_COPY as COPY } from "../learning-copy";
import { DELETED_PARAM } from "../routes";
import { restoreTrack } from "../tracks-actions";
import type { DeletedTrack } from "../tracks-input";
import { failureReason, useLearningSave } from "./use-learning-save";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type TrackDeletedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The track just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedTrack | null;
};

/**
 * After deleting a track from its page, the page sends here with `?deleted=<id>`: focus goes to
 * the heading, the parameter leaves the URL (a reload doesn't repeat it) and «Frente eliminado ·
 * Deshacer» shows in the screen's notices. «Deshacer» restores it with its steps (in progress only
 * if there is room: else «En espera», and the notice says so).
 */
export function TrackDeletedNotice({ headingId, deleted }: TrackDeletedNoticeProps) {
  const { send, toaster } = useLearningSave();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const track = deleted;
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    async function undo() {
      const result = await send(() => restoreTrack({ id: track.id }));
      if (result.ok) {
        push({
          title: COPY.undoneTitle,
          text: result.data.movedToWaiting
            ? COPY.restoredWaiting(track.title)
            : COPY.restored(track.title),
        });
        return;
      }
      push({
        title: COPY.notSavedTitle,
        text: `${COPY.notUndone} ${failureReason(result)}`,
        tone: "error",
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = track.id;
      push({
        title: COPY.deletedTitle,
        text: COPY.deleted(track.title),
        action: { label: COPY.undo, run: () => void undo() },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, send]);

  return null;
}
