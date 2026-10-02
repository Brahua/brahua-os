"use client";

import { usePathname, useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { itemForShortcut, navItems } from "@/lib/modules";
import { requestNavigation } from "@/lib/navigation-guard";
import { QuickCaptureContext } from "@/lib/quick-capture";
import { navShortcutFor } from "@/lib/shortcuts";
import { sidebarCookie } from "../nav-preferences";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";

// Same breakpoint as Tailwind's `lg`, where the sidebar replaces the bottom bar.
const DESKTOP_QUERY = "(min-width: 1024px)";
// The CSS default (extensions.css) covers the first paint; this keeps it exact when the bar
// grows (larger text) so content and scroll targets are never hidden behind it.
const BOTTOM_OFFSET_VAR = "--shell-bottom-offset";
const ITEMS = navItems();

type AppNavProps = {
  /** Read from the cookie on the server, so the first paint has the right width. */
  initialCollapsed: boolean;
  /** Single-key shortcuts on/off (cookie, WCAG 2.1.4). Off: no listener and no hints. */
  shortcutsEnabled: boolean;
};

/**
 * The app's navigation: sidebar from 1024 px, bottom bar below (CSS decides which one shows,
 * so there is no flash). Owns the collapsed state and the global shortcuts `[`, `1`–`8` and `C`,
 * which only act from 1024 px, where the sidebar that shows them is on screen.
 *
 * Quick capture: the orange keys and `C` open the sheet of the registered capture provider
 * (src/lib/quick-capture.ts; `tasks` registers it). Without one the keys show as not available.
 */
export function AppNav({ initialCollapsed, shortcutsEnabled }: AppNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const collapsedRef = useRef(initialCollapsed);
  const bottomNav = useRef<HTMLElement>(null);

  const capture = use(QuickCaptureContext);
  const [captureOpen, setCaptureOpen] = useState(false);
  // New sheet per opening (the form starts empty); none mounted until the first one.
  const [captureOpening, setCaptureOpening] = useState(0);
  const captureTrigger = useRef<HTMLElement | null>(null);
  const openCapture = useCallback((trigger?: HTMLElement) => {
    // The key that was pressed, or what had focus when `C` was pressed: focus returns there. With
    // nothing focused (<body>), the main content, so focus never ends up on <body>.
    const active = document.activeElement;
    captureTrigger.current =
      trigger ??
      (active instanceof HTMLElement && active !== document.body
        ? active
        : document.getElementById("content"));
    setCaptureOpening((value) => value + 1);
    setCaptureOpen(true);
  }, []);
  const canCapture = capture !== null;

  // Writes the cookie only on a real toggle (never on mount).
  const toggleSidebar = useCallback(() => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    document.cookie = sidebarCookie(next, window.location.protocol === "https:");
    setCollapsed(next);
  }, []);

  useEffect(() => {
    if (!shortcutsEnabled) return;
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = navShortcutFor(event);
      if (!shortcut) return;
      // Below 1024 px there is no sidebar showing the keys: leave them alone.
      if (!window.matchMedia(DESKTOP_QUERY).matches) return;
      if (shortcut.type === "toggle-sidebar") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (shortcut.type === "capture") {
        if (!canCapture) return;
        event.preventDefault();
        openCapture();
        return;
      }
      const item = itemForShortcut(ITEMS, shortcut.digit);
      if (!item) return;
      event.preventDefault();
      // Through the guard: a screen with unsaved changes asks first (src/lib/navigation-guard.ts).
      if (window.location.pathname !== item.href) {
        requestNavigation(item.href, () => router.push(item.href));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    // Shortcuts only work once hydrated; E2E waits for this marker before pressing keys.
    document.documentElement.dataset.navShortcuts = "ready";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      delete document.documentElement.dataset.navShortcuts;
    };
  }, [router, shortcutsEnabled, toggleSidebar, canCapture, openCapture]);

  useEffect(() => {
    const bar = bottomNav.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      const height = bar.getBoundingClientRect().height;
      // 0 when hidden (≥ 1024 px): fall back to the stylesheet.
      if (height > 0) root.style.setProperty(BOTTOM_OFFSET_VAR, `${height}px`);
      else root.style.removeProperty(BOTTOM_OFFSET_VAR);
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BOTTOM_OFFSET_VAR);
    };
  }, []);

  return (
    <>
      <div className="sticky top-0 z-40 hidden h-dvh shrink-0 lg:block">
        <Sidebar
          items={ITEMS}
          pathname={pathname}
          collapsed={collapsed}
          onToggle={toggleSidebar}
          shortcuts={shortcutsEnabled}
          onCapture={capture ? openCapture : undefined}
          onCapturePreload={capture?.preload}
          className="h-full"
        />
      </div>
      <div className="lg:hidden">
        <BottomNav
          ref={bottomNav}
          items={ITEMS}
          pathname={pathname}
          onCapture={capture ? openCapture : undefined}
          onCapturePreload={capture?.preload}
          className="bo-bottomnav--fixed"
        />
      </div>
      {capture && captureOpening > 0 ? (
        <capture.Sheet
          key={captureOpening}
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          returnFocusRef={captureTrigger}
        />
      ) : null}
    </>
  );
}
