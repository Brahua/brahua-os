// Guards against leaving a screen with unsaved changes (first used by project notes, P5).
// Client-only. The App Router has no "before navigate" hook, so three paths are covered:
// - closing, reloading or leaving the site: the browser's own `beforeunload` prompt (the only
//   thing a page may show there);
// - clicking a same-origin link (sidebar, bottom bar, "Volver a…"): a capture listener on
//   `window` stops the click before Next's <Link> sees it and hands the decision to the screen,
//   which asks inside the page and then navigates (or not);
// - programmatic in-app navigation that goes through `requestNavigation` (the number shortcuts).
// Not covered: the browser's back and forward buttons inside the app (Next handles popstate
// itself and it can't be cancelled); see docs/HANDOFF.md.
import { useEffect, useRef } from "react";

/** Asked before an in-app navigation; returns true when it took over (and will call `proceed`). */
type Guard = (href: string, proceed: () => void) => boolean;

const guards = new Set<Guard>();

/** In-app navigation from code: runs `navigate` unless a guard takes over. */
export function requestNavigation(href: string, navigate: () => void): void {
  for (const guard of guards) {
    if (guard(href, navigate)) return;
  }
  navigate();
}

/** The same-origin page a click on `anchor` would open in this tab, or null if none. */
export function inAppHref(event: MouseEvent, anchor: HTMLAnchorElement): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = anchor.getAttribute("target");
  if ((target && target !== "_self") || anchor.hasAttribute("download")) return null;
  const raw = anchor.getAttribute("href");
  if (raw === null) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const here = window.location;
  // Only the fragment changes: same page, nothing is lost.
  if (url.pathname === here.pathname && url.search === here.search && url.hash) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * While `dirty`, asks before the page is left. `onBlocked(proceed)` should ask the owner inside
 * the page and call `proceed()` to leave anyway.
 */
export function useUnsavedChangesGuard(dirty: boolean, onBlocked: (proceed: () => void) => void) {
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  });

  useEffect(() => {
    if (!dirty) return;
    // Set once the owner chose to leave anyway: nothing blocks that navigation.
    let released = false;
    const release = () => {
      released = true;
      guards.delete(guard);
    };

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (released) return;
      event.preventDefault();
      // Older browsers still need returnValue set to show the prompt.
      event.returnValue = "";
    }

    function onClick(event: MouseEvent) {
      if (released) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = inAppHref(event, anchor);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      onBlockedRef.current(() => {
        release();
        // Through the anchor again, now that nothing blocks: Next's <Link> navigates on the
        // client and a plain anchor loads the page.
        anchor.click();
      });
    }

    const guard: Guard = (_href, proceed) => {
      if (released) return false;
      onBlockedRef.current(() => {
        release();
        proceed();
      });
      return true;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    guards.add(guard);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
      guards.delete(guard);
    };
  }, [dirty]);
}
