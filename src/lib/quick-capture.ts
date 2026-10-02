// Extension point of the quick capture key (SPEC-tasks "Captura rápida"): the shell of `core`
// shows the orange key, the sidebar's capture button and the `C` shortcut, but what they open
// belongs to another module (`tasks`). That module registers a provider here, at import time
// (like the navigation manifests and the progress sources), and the composition root
// (src/lib/capture-providers.tsx, rendered by the app layout) loads it and hands it to the shell
// through `QuickCaptureContext`. `core` never imports `tasks`.
//
// Client-safe: plain data and React types, no server code.
import { createContext, type ComponentType, type RefObject } from "react";

/** What the shell passes to the provider's sheet. */
export type CaptureSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when it closes: the key that opened it (Safari doesn't focus a button on
   * click), or what had focus when `C` was pressed.
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

export type CaptureRegistry = {
  /**
   * Registers the capture provider. One owner only: registering the same id again replaces it
   * (a hot reload), another id while one is registered throws. Returns a function that removes
   * this same provider (never a newer one with its id).
   */
  register: (provider: CaptureProvider) => () => void;
  /** The registered provider, or null (the key then shows as not available yet). */
  current: () => CaptureProvider | null;
};

export function createCaptureRegistry(): CaptureRegistry {
  let provider: CaptureProvider | null = null;
  return {
    register(next) {
      if (provider && provider.id !== next.id) {
        throw new Error(
          `Quick capture already belongs to "${provider.id}"; "${next.id}" can't register too.`,
        );
      }
      provider = next;
      return () => {
        if (provider === next) provider = null;
      };
    },
    current: () => provider,
  };
}

/** The app's registry. Providers call `registerCaptureProvider` at the top level of their file. */
const appRegistry = createCaptureRegistry();

export const registerCaptureProvider = appRegistry.register;
export const currentCaptureProvider = appRegistry.current;

/** The provider the shell uses (set by the composition root); null without one. */
export const QuickCaptureContext = createContext<CaptureProvider | null>(null);
