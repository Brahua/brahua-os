"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Toast } from "@/design-system";
import { isDismissShortcut, isDragActive, isUndoShortcut } from "@/lib/shortcuts";
import type { Notice } from "@/lib/toast/queue";
import type { Toaster } from "@/lib/toast/use-toaster";

// Lives in `core`, not in the design system: it is tied to the app shell (the bottom bar's
// offset, `#content` as the focus fallback, the app's keyboard rules and the scroll padding
// that keeps focused controls clear of it). The `Toast` it renders is the design system's.

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Radix portals its dialogs into <body>; watching it tells when one is open. */
function subscribeToDialogs(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true });
  return () => observer.disconnect();
}

const dialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/** Space a visible notice takes at the bottom of the screen (its height plus the gap). */
const TOAST_OFFSET = "--toast-offset";
const TOAST_GAP = 24;

type ToastViewportProps = {
  toaster: Toaster;
  /** Name of the notices region ("Avisos"). */
  label: string;
  /** Read after a notice with an action (hidden on screen): how to undo without hunting. */
  actionHint: string;
};

/**
 * Where the notices show, one at a time, above the bottom bar on the phone.
 * - A named region ("Avisos") with a polite live region inside that is always in the page, so
 *   each new notice is announced. Notices with an action also announce how to use it.
 * - It never takes focus. "Deshacer" is reachable with Tab or with ⌘Z / Ctrl+Z.
 * - Each notice leaves on its own after its duration (WCAG 2.2.1: long enough, and the timer
 *   pauses while hovered, focused, while a dialog is open, or while the tab is hidden).
 * - Esc dismisses it, from inside it or from the page (not while typing, in a dialog or while
 *   dragging).
 * - Focus never ends up on <body>: after "Deshacer", Esc, or a notice replaced while focused,
 *   it goes back where it was before entering the notice (or to the main content).
 * - While visible, `--toast-offset` on <html> adds its height to the page's scroll padding, so
 *   a focused control is never hidden behind it (WCAG 2.4.11).
 */
export function ToastViewport({ toaster, label, actionHint }: ToastViewportProps) {
  const { state, dismiss } = toaster;
  const visible = state.visible;
  // Which notice the pointer or focus is on: a notice that leaves while hovered gets no
  // mouseleave, and the next one must not inherit the pause.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const hidden = useSyncExternalStore(
    subscribeToVisibility,
    () => document.hidden,
    () => false,
  );
  // With a dialog open, the page (and so this region) is aria-hidden: the notice must wait.
  const dialog = useSyncExternalStore(subscribeToDialogs, dialogOpen, () => false);
  const paused =
    hidden || dialog || (visible !== null && (hoverId === visible.id || focusId === visible.id));
  // Held while a dialog is open: the page (and so this region) is aria-hidden and under the
  // sheet, so a notice shown now would be neither heard nor seen (e.g. "Deshacer" after deleting
  // from a sheet that is still closing). It shows, and is announced, once the dialog is gone.
  const shown = dialog ? null : visible;

  // Time left for the notice on screen; reset when a new one (or new content) shows.
  const remaining = useRef<{ key: number; ms: number } | null>(null);
  const visibleKey = visible?.key;
  const visibleId = visible?.id;
  const visibleDuration = visible?.duration;
  useEffect(() => {
    if (visibleKey === undefined || !visibleId || visibleDuration === undefined) return;
    if (remaining.current?.key !== visibleKey) {
      remaining.current = { key: visibleKey, ms: visibleDuration };
    }
    // Infinity: a notice that stays until it is dismissed (or the screen goes away).
    if (paused || !Number.isFinite(remaining.current.ms)) return;
    const left = remaining.current;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss(visibleId), Math.max(0, left.ms));
    return () => {
      window.clearTimeout(timer);
      left.ms -= performance.now() - started;
    };
  }, [visibleKey, visibleId, visibleDuration, paused, dismiss]);

  const region = useRef<HTMLElement>(null);
  // Where focus was before it entered the notice, to go back there when the notice leaves.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Whether focus is inside: a removed button gets no blur, so this outlives it.
  const focusInside = useRef(false);

  const restoreFocus = useCallback(() => {
    const target = returnFocus.current;
    returnFocus.current = null;
    focusInside.current = false;
    setFocusId(null);
    setHoverId(null);
    const active = document.activeElement;
    if (!active || active === document.body || region.current?.contains(active)) {
      const fallback = document.getElementById("content");
      (target?.isConnected ? target : fallback)?.focus({ preventScroll: true });
    }
  }, []);

  // The notice that had focus was replaced or dismissed from code: don't leave focus on <body>.
  useLayoutEffect(() => {
    if (focusInside.current && !region.current?.contains(document.activeElement)) {
      restoreFocus();
    }
  }, [visibleId, restoreFocus]);

  const runAction = useCallback(
    (notice: Notice) => {
      restoreFocus();
      dismiss(notice.id);
      notice.action?.run();
    },
    [dismiss, restoreFocus],
  );

  // ⌘Z / Ctrl+Z runs the action of the notice on screen; Esc dismisses it.
  useEffect(() => {
    if (!shown) return;
    const notice = shown;
    function onKeyDown(event: KeyboardEvent) {
      if (isDragActive()) return;
      if (notice.action && isUndoShortcut(event)) {
        event.preventDefault();
        runAction(notice);
      } else if (isDismissShortcut(event)) {
        event.preventDefault();
        restoreFocus();
        dismiss(notice.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, runAction, restoreFocus, dismiss]);

  // Publish the space the notice takes, for the scroll padding (see extensions.css).
  const live = useRef<HTMLDivElement>(null);
  const hasNotice = shown !== null;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const element = live.current;
    if (!hasNotice || !element) {
      root.style.removeProperty(TOAST_OFFSET);
      return;
    }
    const update = () => {
      const height = element.getBoundingClientRect().height;
      root.style.setProperty(TOAST_OFFSET, `${height > 0 ? Math.ceil(height) + TOAST_GAP : 0}px`);
    };
    update();
    // Text wraps and can grow (zoom, longer notices in place): follow its size.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOAST_OFFSET);
    };
  }, [hasNotice]);

  return (
    <section
      ref={region}
      aria-label={label}
      className="bo-toast-viewport"
      onMouseEnter={() => setHoverId(shown?.id ?? null)}
      onMouseLeave={() => setHoverId(null)}
      onFocus={(event) => {
        if (!region.current?.contains(event.relatedTarget as Node | null)) {
          returnFocus.current = event.relatedTarget as HTMLElement | null;
        }
        focusInside.current = true;
        setFocusId(shown?.id ?? null);
      }}
      onBlur={(event) => {
        if (!region.current?.contains(event.relatedTarget as Node | null)) {
          focusInside.current = false;
          setFocusId(null);
        }
      }}
    >
      <div ref={live} role="status" aria-live="polite" aria-atomic="true">
        {shown ? (
          <Toast
            // By id: an update in place keeps the button (and its focus).
            key={shown.id}
            live={false}
            title={shown.title}
            text={
              shown.action ? (
                <>
                  {shown.text}
                  <span className="sr-only"> {actionHint}</span>
                </>
              ) : (
                shown.text
              )
            }
            actionLabel={shown.action?.label}
            onAction={shown.action ? () => runAction(shown) : undefined}
            actionProps={{ "aria-keyshortcuts": "Meta+Z Control+Z" }}
          />
        ) : null}
      </div>
    </section>
  );
}
