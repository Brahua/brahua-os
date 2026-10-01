"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Toast } from "@/design-system";
import { isUndoShortcut } from "@/lib/shortcuts";
import {
  EMPTY_TOASTS,
  TOAST_DURATION,
  toastReducer,
  type Notice,
  type ToastState,
} from "../toast-queue";

/** A notice to show; `id` and `duration` get defaults. */
export type NoticeInput = Omit<Notice, "id" | "duration"> & { id?: string; duration?: number };

export type Toaster = {
  state: ToastState;
  /** Queues a notice and returns its id. */
  push: (notice: NoticeInput) => string;
  /** Updates a notice in place (same id), or queues it if it is gone. */
  replace: (notice: NoticeInput & { id: string }) => void;
  dismiss: (id: string) => void;
};

let lastId = 0;

function complete(notice: NoticeInput): Notice {
  return {
    ...notice,
    id: notice.id ?? `notice-${++lastId}`,
    duration: notice.duration ?? (notice.action ? TOAST_DURATION.withAction : TOAST_DURATION.plain),
  };
}

/**
 * The notice queue. Call `push` from event handlers or after an `await`: inside a transition,
 * before its first `await`, React would hold the update until the transition ends.
 */
export function useToaster(): Toaster {
  const [state, dispatch] = useReducer(toastReducer, EMPTY_TOASTS);
  const push = useCallback((notice: NoticeInput) => {
    const full = complete(notice);
    dispatch({ type: "push", notice: full });
    return full.id;
  }, []);
  const replace = useCallback(
    (notice: NoticeInput & { id: string }) =>
      dispatch({ type: "replace", notice: complete(notice) }),
    [],
  );
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  return useMemo(() => ({ state, push, replace, dismiss }), [state, push, replace, dismiss]);
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * Where the notices show, one at a time, above the bottom bar on the phone.
 * - A polite live region that is always in the page, so each new notice is announced.
 * - It never takes focus. "Deshacer" is reachable with Tab or with ⌘Z / Ctrl+Z.
 * - Each notice leaves on its own after its duration (WCAG 2.2.1: long enough, and the timer
 *   pauses while hovered, focused or the tab is hidden); Esc dismisses it from inside.
 * - After "Deshacer" or Esc, focus goes back where it was before entering the notice.
 */
export function ToastViewport({ toaster, label }: { toaster: Toaster; label: string }) {
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
  const paused = hidden || (visible !== null && (hoverId === visible.id || focusId === visible.id));

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
    if (paused) return;
    const left = remaining.current;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss(visibleId), Math.max(0, left.ms));
    return () => {
      window.clearTimeout(timer);
      left.ms -= performance.now() - started;
    };
  }, [visibleKey, visibleId, visibleDuration, paused, dismiss]);

  // Where focus was before it entered the notice, to go back there when the notice leaves.
  const returnFocus = useRef<HTMLElement | null>(null);
  const region = useRef<HTMLDivElement>(null);

  const leave = useCallback(() => {
    const target = returnFocus.current;
    returnFocus.current = null;
    setFocusId(null);
    setHoverId(null);
    if (region.current?.contains(document.activeElement)) {
      const fallback = document.getElementById("content");
      (target?.isConnected ? target : fallback)?.focus({ preventScroll: true });
    }
  }, []);

  const runAction = useCallback(
    (notice: Notice) => {
      leave();
      dismiss(notice.id);
      notice.action?.run();
    },
    [dismiss, leave],
  );

  // ⌘Z / Ctrl+Z runs the action of the notice on screen.
  useEffect(() => {
    if (!visible?.action) return;
    const notice = visible;
    function onKeyDown(event: KeyboardEvent) {
      if (!isUndoShortcut(event)) return;
      event.preventDefault();
      runAction(notice);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, runAction]);

  return (
    <div
      ref={region}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={label}
      className="bo-toast-viewport"
      onMouseEnter={() => setHoverId(visible?.id ?? null)}
      onMouseLeave={() => setHoverId(null)}
      onFocus={(event) => {
        if (!region.current?.contains(event.relatedTarget as Node | null)) {
          returnFocus.current = event.relatedTarget as HTMLElement | null;
        }
        setFocusId(visible?.id ?? null);
      }}
      onBlur={(event) => {
        if (!region.current?.contains(event.relatedTarget as Node | null)) setFocusId(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !visible) return;
        event.preventDefault();
        leave();
        dismiss(visible.id);
      }}
    >
      {visible ? (
        <Toast
          // By id: an update in place keeps the button (and its focus).
          key={visible.id}
          live={false}
          title={visible.title}
          text={visible.text}
          actionLabel={visible.action?.label}
          onAction={visible.action ? () => runAction(visible) : undefined}
          actionProps={{ "aria-keyshortcuts": "Meta+Z Control+Z" }}
        />
      ) : null}
    </div>
  );
}
