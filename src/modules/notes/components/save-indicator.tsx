"use client";

import { cn } from "@/lib/cn";
import { NOTES_COPY as COPY } from "../copy";
import type { SaveStatus } from "./use-note-autosave";

/** The text of the autosave indicator for a status ("" when there is nothing to say). */
export function saveStatusText(status: SaveStatus): string {
  switch (status.kind) {
    case "saving":
      return COPY.saving;
    case "saved":
      return COPY.saved;
    case "failed":
      return COPY.unsaved(status.reason);
    default:
      return "";
  }
}

/**
 * The discreet autosave indicator (SPEC-notes "Guardado"): «Guardando…», «Guardado» or «Sin
 * guardar: …». Only visual: what screen readers hear goes through the screen's announcer, with
 * less noise (`useNoteAutosave` decides: a failure once per reason, «Guardado» on closing the
 * editor or after a failure).
 */
export function SaveIndicator({ status, className }: { status: SaveStatus; className?: string }) {
  return (
    <p
      data-note-save-status={status.kind}
      className={cn(
        "bo-text-body-sm",
        status.kind === "failed" ? "text-text" : "text-text-secondary",
        className,
      )}
    >
      {saveStatusText(status)}
    </p>
  );
}
