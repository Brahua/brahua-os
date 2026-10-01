// React state for the notice queue (./queue.ts). Client-only (a hook); rendering is the
// viewport's job.
import { useCallback, useMemo, useReducer } from "react";
import { EMPTY_TOASTS, TOAST_DURATION, toastReducer, type Notice, type ToastState } from "./queue";

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

function defaultDuration(notice: NoticeInput): number {
  if (notice.tone === "error") return TOAST_DURATION.error;
  return notice.action ? TOAST_DURATION.withAction : TOAST_DURATION.plain;
}

function complete(notice: NoticeInput): Notice {
  return {
    ...notice,
    id: notice.id ?? `notice-${++lastId}`,
    duration: notice.duration ?? defaultDuration(notice),
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
