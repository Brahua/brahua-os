// Extension point of the quick capture key (SPEC-tasks "Captura rápida", SPEC-finance
// "Contratos"): the shell of `core` shows the orange key, the sidebar's capture button and the
// `C` shortcut, but what they open belongs to other modules (`tasks`, `finance`). The composition
// root (src/lib/capture-providers.tsx, rendered by the app layout) hands the modules' providers
// to the shell through `QuickCaptureContext`, as an ordered list. `core` never imports a module.
//
// With more than one provider the shell lets the owner pick ("Tarea · Gasto") and remembers the
// choice on the device; each provider's sheet shows that switch (`switcher`) at its top.
//
// Context only, no module-level registry: the root names the providers explicitly, so there is no
// registration order to get wrong and nothing a bundler can drop as an unused side effect.
// Client-safe: plain data and React types, no server code.
import { createContext, type ComponentType, type ReactNode, type RefObject } from "react";

/** What the shell passes to the provider's sheet. */
export type CaptureSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when it closes: the key that was pressed (Safari doesn't focus a button on
   * click), or what had focus when `C` was pressed (the main content if that was nothing).
   */
  returnFocusRef: RefObject<HTMLElement | null>;
  /**
   * With several providers, the shell's switch between them ("Tarea · Gasto"): the sheet renders
   * it first in its body. Picking another provider replaces the sheet with that one's.
   */
  switcher?: ReactNode;
};

export type CaptureProvider = {
  /** Stable id of the module that owns the capture (e.g. "tasks"). */
  id: string;
  /** What it captures, for the switch between providers ("Tarea", "Gasto"). */
  label: string;
  /**
   * The capture sheet. The shell mounts it on the first opening only, so the provider should
   * load its code lazily (next/dynamic) and keep the shell's bundle small.
   */
  Sheet: ComponentType<CaptureSheetProps>;
  /** Fetches the sheet's code ahead of time (the key is pointed at, focused or touched). */
  preload?: () => void;
};

/** The providers the shell offers, in order (set by the composition root); empty without one. */
export const QuickCaptureContext = createContext<readonly CaptureProvider[]>([]);

/** Where the device remembers the last provider picked (an id; per device, not per account). */
export const CAPTURE_CHOICE_KEY = "bo_capture_kind";

/** The remembered provider id, or null (none yet, or storage unavailable: private mode). */
export function readCaptureChoice(): string | null {
  try {
    return window.localStorage.getItem(CAPTURE_CHOICE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the provider picked; storage that fails (private mode, full) is ignored. */
export function rememberCaptureChoice(id: string): void {
  try {
    window.localStorage.setItem(CAPTURE_CHOICE_KEY, id);
  } catch {
    // Nothing to do: the first provider is the default next time.
  }
}

/** The provider with `id`, else the first one (null without providers). */
export function pickCaptureProvider(
  providers: readonly CaptureProvider[],
  id: string | null,
): CaptureProvider | null {
  return providers.find((provider) => provider.id === id) ?? providers[0] ?? null;
}
