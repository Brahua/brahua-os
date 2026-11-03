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
 * guardar: …», in a polite live region that is always on the page (a region added with its text
 * isn't read).
 */
export function SaveIndicator({ status, className }: { status: SaveStatus; className?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
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
