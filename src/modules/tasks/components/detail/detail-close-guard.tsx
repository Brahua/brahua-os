"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef } from "react";

/** Asked before the detail sheet closes; returns true when it took over (and will call `proceed`). */
type CloseGuard = (proceed: () => void) => boolean;

type CloseGuards = {
  add: (guard: CloseGuard) => () => void;
  /** True when nothing blocks closing now; otherwise a guard took over. */
  allowClose: (proceed: () => void) => boolean;
};

const CloseGuardContext = createContext<CloseGuards | null>(null);

/**
 * Lets a section of the detail sheet stop it from closing (Esc, the close key, a click outside)
 * while it has unsaved changes (the notes). Links are covered by `useUnsavedChangesGuard`; a
 * sheet closing is not a navigation, so it asks here. The page host doesn't need it.
 */
export function DetailCloseGuardProvider({ children }: { children: React.ReactNode }) {
  const guards = useRef(new Set<CloseGuard>());
  const add = useCallback((guard: CloseGuard) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);
  const allowClose = useCallback((proceed: () => void) => {
    for (const guard of guards.current) {
      if (guard(proceed)) return false;
    }
    return true;
  }, []);
  const value = useMemo(() => ({ add, allowClose }), [add, allowClose]);
  return <CloseGuardContext value={value}>{children}</CloseGuardContext>;
}

/** Whether the sheet may close now (always, outside a sheet). */
export function useAllowDetailClose(): (proceed: () => void) => boolean {
  const guards = use(CloseGuardContext);
  return guards?.allowClose ?? alwaysAllow;
}

const alwaysAllow = () => true;

/**
 * While `dirty`, closing the sheet asks first: `onBlocked(proceed)` should ask inside the sheet
 * and call `proceed()` to close anyway. Nothing outside a sheet.
 */
export function useDetailCloseGuard(dirty: boolean, onBlocked: (proceed: () => void) => void) {
  const guards = use(CloseGuardContext);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  });
  useEffect(() => {
    if (!dirty || !guards) return;
    let released = false;
    const guard: CloseGuard = (proceed) => {
      if (released) return false;
      onBlockedRef.current(() => {
        released = true;
        proceed();
      });
      return true;
    };
    return guards.add(guard);
  }, [dirty, guards]);
}
