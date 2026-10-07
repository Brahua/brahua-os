"use client";

import { cn } from "@/lib/cn";

type CapturePreviewProps = {
  /** What was understood ("Vence el vie 10 oct · 10:00"), or null when nothing was. */
  summary: string | null;
  /** The summary as a screen reader should hear it, with how to undo it. */
  spoken: string;
  /** The key's visible word ("Quitar"). */
  removeText: string;
  /** Called by the touch (or Enter/Space on the key): the owner wants the text as typed. */
  onRemove: () => void;
  className?: string;
};

/**
 * The live preview of a quick capture's natural-language reading (polish → capture-nl-dates): a
 * strip in the LCD style under the field, one touch (44 px+) to cancel it. The polite status
 * region is always mounted (one that appears together with its content is often not announced);
 * it speaks only when the reading changes, never on every keystroke, and never in red: an
 * interpretation is a suggestion, not a mistake. The key never takes focus with it: whoever
 * unmounts it (the host, on `onRemove`) puts focus back in the field.
 */
export function CapturePreview({
  summary,
  spoken,
  removeText,
  onRemove,
  className,
}: CapturePreviewProps) {
  return (
    <div className={className} data-nl-preview-root="">
      <p role="status" aria-live="polite" className="sr-only" data-nl-status="">
        {summary ? spoken : ""}
      </p>
      {summary ? (
        <button
          type="button"
          className={cn(
            "bo-lcd min-h-11 w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          )}
          data-nl-preview=""
          onClick={onRemove}
        >
          <span className="bo-lcd__text">
            <span aria-hidden>→ </span>
            {summary}
          </span>
          <span className="bo-lcd__meta">{removeText}</span>
        </button>
      ) : null}
    </div>
  );
}
