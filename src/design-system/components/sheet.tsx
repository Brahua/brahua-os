"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { Kbd } from "./kbd";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `bottom` sheet (phone) or 420 px `side` panel (desktop). */
  variant?: "bottom" | "side";
  title: string;
  /**
   * A short label under the title (mono, uppercase), e.g. "Aprendizaje · meta 20 nov". Without a
   * `description`, it is the dialog's description.
   */
  subtitle?: string;
  /**
   * A sentence or two explaining the sheet, under the title as body text (sentence case,
   * secondary color, 8 px under the title). It is the dialog's description. Use it instead of
   * `subtitle` for anything longer than a label; the side panel's header grows with it.
   */
  description?: string;
  footer?: React.ReactNode;
  /**
   * Modal with scrim (captures focus). Without it, the side panel leaves the page usable
   * (e.g. project detail next to the project grid).
   */
  modal?: boolean;
  /**
   * Where focus goes on close. By default, whatever had focus when it opened; but Safari doesn't
   * focus a button on click, so pass the opener here to be sure.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * What gets focus on open (e.g. the current option of a list). By default Radix focuses the
   * first focusable control that is not a link: often the ✕.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Without `initialFocusRef`, focus the title on open (e.g. on the phone, where focusing a
   * field would open the keyboard over the list).
   */
  focusTitleOnOpen?: boolean;
  /**
   * Called once the sheet has fully closed: exit animation done, content unmounted, focus back
   * and the rest of the page no longer `aria-hidden`. Announce results here, or screen readers
   * skip them (they ignore live regions inside hidden content).
   */
  onClosed?: () => void;
  /**
   * The ✕ shows as unavailable (aria-disabled) and does nothing, e.g. while the form saves.
   * Esc and the scrim are up to `onOpenChange`, which should ignore them too.
   */
  closeDisabled?: boolean;
  className?: string;
  /** Classes for the scrolling body (e.g. `scroll-padding` under a sticky header). */
  bodyClassName?: string;
  children: React.ReactNode;
};

/**
 * Bottom sheet (phone) or 420 px side panel (desktop) — design system `Sheet`.
 * Built on Radix Dialog: focus trap (when modal), Esc to close, focus returns to the trigger.
 */
export function Sheet({
  open,
  onOpenChange,
  variant = "bottom",
  title,
  subtitle,
  description,
  footer,
  modal = true,
  returnFocusRef,
  initialFocusRef,
  focusTitleOnOpen = false,
  onClosed,
  closeDisabled = false,
  className,
  bodyClassName,
  children,
}: SheetProps) {
  const side = variant === "side";
  // Radix only restores focus to a <Dialog.Trigger>. Sheets are opened from any control
  // (e.g. the Capture key), so remember what had focus and return to it on close.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        {modal ? <Dialog.Overlay className="bo-scrim bo-sheet-overlay" /> : null}
        <Dialog.Content
          // Without a subtitle or a description there is none; tell Radix so it doesn't warn.
          {...(subtitle || description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            returnFocusTo.current = document.activeElement as HTMLElement | null;
            const target = initialFocusRef?.current ?? (focusTitleOnOpen ? titleRef.current : null);
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (returnFocusRef?.current ?? returnFocusTo.current)?.focus();
            returnFocusTo.current = null;
            onClosed?.();
          }}
          className={cn(
            "bo-sheet",
            side
              ? "bo-sheet--side bo-sheet-position--side"
              : "bo-sheet--bottom bo-sheet-position--bottom",
            className,
          )}
        >
          {!side ? <div className="bo-sheet__handle" aria-hidden /> : null}
          <div className="bo-sheet__header">
            <div className="bo-sheet__heading">
              <Dialog.Title
                ref={titleRef}
                tabIndex={focusTitleOnOpen ? -1 : undefined}
                className={cn("bo-sheet__title", focusTitleOnOpen && "outline-none")}
              >
                {title}
              </Dialog.Title>
              {subtitle ? (
                description ? (
                  <span className="bo-text-label text-text-secondary">{subtitle}</span>
                ) : (
                  // Without a description, the label describes the dialog.
                  <Dialog.Description className="bo-text-label text-text-secondary">
                    {subtitle}
                  </Dialog.Description>
                )
              ) : null}
              {description ? (
                <Dialog.Description className="bo-sheet__description">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {/* Top-aligned (extensions.css): it stays by the title when a description wraps. */}
            <Dialog.Close
              className={cn(
                "bo-key bo-key--ghost bo-key--sm bo-sheet__close",
                closeDisabled && "is-disabled",
              )}
              aria-label="Cerrar (Esc)"
              aria-keyshortcuts="Escape"
              // aria-disabled, never disabled: the button may have focus (it keeps it).
              aria-disabled={closeDisabled || undefined}
              onClick={closeDisabled ? (event) => event.preventDefault() : undefined}
            >
              {side ? <Kbd keys="Esc" aria-hidden /> : null}
              <Icon icon={X} />
            </Dialog.Close>
          </div>
          <div className={cn("bo-sheet__body", bodyClassName)}>{children}</div>
          {footer ? <div className="bo-sheet__footer">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
