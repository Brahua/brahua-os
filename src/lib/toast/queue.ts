// A queue of notices shown one at a time (the design system `Toast`). Pure state, no React:
// `useToaster` (./use-toaster.ts) holds it, and a viewport renders it (for now
// src/modules/core/components/toast-viewport.tsx, per screen).
//
// Later: one queue for all of (app), provided by the layout, so a notice survives navigation
// and two screens never show two viewports. Nothing here needs to change for that.

export type ToastAction = {
  label: string;
  run: () => void;
};

export type Notice = {
  /** Stable id: `replace` and `dismiss` refer to it. */
  id: string;
  title: string;
  text: string;
  action?: ToastAction;
  /** Errors stay longer (TOAST_DURATION.error). */
  tone?: "info" | "error";
  /** How long it stays on screen (paused while hovered or focused); Infinity: until dismissed. */
  duration: number;
};

export type ToastState = {
  /** The notice on screen; `key` changes whenever its content does (restarts its timer). */
  visible: (Notice & { key: number }) | null;
  /** Waiting notices, oldest first. */
  queue: Notice[];
  /** Source of `key`. */
  serial: number;
};

export type ToastEvent =
  | { type: "push"; notice: Notice }
  /** Updates a notice in place (on screen or waiting); pushes it if it is gone. */
  | { type: "replace"; notice: Notice }
  | { type: "dismiss"; id: string };

/** Older notices are dropped beyond this many waiting: they would show long after the fact. */
export const MAX_QUEUED = 3;

/**
 * How long a notice stays (paused on hover and focus). A notice with an action ("Deshacer") has
 * no time limit (WCAG 2.2.1): it stays until it is dismissed or the next notice replaces it (see
 * `enqueue`), or the screen goes away. Plain notices and errors keep a timer.
 */
export const TOAST_DURATION = {
  withAction: Number.POSITIVE_INFINITY,
  plain: 6_000,
  error: 12_000,
} as const;

export const EMPTY_TOASTS: ToastState = { visible: null, queue: [], serial: 0 };

function show(state: ToastState, notice: Notice | undefined, queue: Notice[]): ToastState {
  if (!notice) return { ...state, visible: null, queue };
  return { visible: { ...notice, key: state.serial + 1 }, queue, serial: state.serial + 1 };
}

function enqueue(state: ToastState, notice: Notice): ToastState {
  if (!state.visible) return show(state, notice, state.queue);
  // A notice without a time limit (an undo) lasts until the next one: it gives way at once
  // instead of holding the queue forever. To an error it only gives way for a while (the error
  // says why something failed now; the undo it covered comes back after it); to anything else,
  // for good (the next action's notice replaces it).
  if (!Number.isFinite(state.visible.duration)) {
    // Back to a plain notice (the on-screen `key` is given again when it shows).
    const covered: Notice = {
      id: state.visible.id,
      title: state.visible.title,
      text: state.visible.text,
      action: state.visible.action,
      tone: state.visible.tone,
      duration: state.visible.duration,
    };
    const queue = notice.tone === "error" ? [covered, ...state.queue] : state.queue;
    return show(state, notice, queue.slice(0, MAX_QUEUED));
  }
  return { ...state, queue: [...state.queue, notice].slice(-MAX_QUEUED) };
}

export function toastReducer(state: ToastState, event: ToastEvent): ToastState {
  switch (event.type) {
    case "push":
      return enqueue(state, event.notice);
    case "replace": {
      const { notice } = event;
      if (state.visible?.id === notice.id) return show(state, notice, state.queue);
      if (state.queue.some((item) => item.id === notice.id)) {
        return {
          ...state,
          queue: state.queue.map((item) => (item.id === notice.id ? notice : item)),
        };
      }
      return enqueue(state, notice);
    }
    case "dismiss": {
      if (state.visible?.id === event.id) {
        const [next, ...rest] = state.queue;
        return show(state, next, rest);
      }
      const queue = state.queue.filter((item) => item.id !== event.id);
      return queue.length === state.queue.length ? state : { ...state, queue };
    }
  }
}

/** Whether a notice is on screen or waiting. */
export function hasNotice(state: ToastState, id: string): boolean {
  return state.visible?.id === id || state.queue.some((item) => item.id === id);
}
