// Extension point of the quick capture key (SPEC-tasks "Captura rápida"): the shell of `core`
// shows the orange key, the sidebar's capture button and the `C` shortcut, but what they open
// belongs to another module (`tasks`). The composition root (src/lib/capture-providers.tsx,
// rendered by the app layout) hands the owning module's provider to the shell through
// `QuickCaptureContext`. `core` never imports `tasks`.
//
// Context only, no module-level registry: the root names the provider explicitly, so there is no
// registration order to get wrong and nothing a bundler can drop as an unused side effect.
// Client-safe: plain data and React types, no server code.
import { createContext, type ComponentType, type RefObject } from "react";

/** What the shell passes to the provider's sheet. */
export type CaptureSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when it closes: the key that was pressed (Safari doesn't focus a button on
   * click), or what had focus when `C` was pressed (the main content if that was nothing).
   */
  returnFocusRef: RefObject<HTMLElement | null>;
};

export type CaptureProvider = {
  /** Stable id of the module that owns the capture (e.g. "tasks"). */
  id: string;
  /**
   * The capture sheet. The shell mounts it on the first opening only, so the provider should
   * load its code lazily (next/dynamic) and keep the shell's bundle small.
   */
  Sheet: ComponentType<CaptureSheetProps>;
  /** Fetches the sheet's code ahead of time (the key is pointed at, focused or touched). */
  preload?: () => void;
};

/** The provider the shell uses (set by the composition root); null without one. */
export const QuickCaptureContext = createContext<CaptureProvider | null>(null);
