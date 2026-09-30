"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { navItems } from "@/lib/modules";
import { navShortcutFor } from "@/lib/shortcuts";
import { sidebarCookie } from "../sidebar-state";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";

// Same breakpoint as Tailwind's `lg`, where the sidebar replaces the bottom bar.
const DESKTOP_QUERY = "(min-width: 1024px)";
const ITEMS = navItems();

type AppNavProps = {
  /** Read from the cookie on the server, so the first paint has the right width. */
  initialCollapsed: boolean;
};

/**
 * The app's navigation: sidebar from 1024 px, bottom bar below (CSS decides which one shows,
 * so there is no flash). Owns the collapsed state and the global shortcuts `[` and `1`–`8`.
 */
export function AppNav({ initialCollapsed }: AppNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // Remember the choice on this device; the layout reads it back on the next request.
  useEffect(() => {
    document.cookie = sidebarCookie(collapsed, window.location.protocol === "https:");
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = navShortcutFor(event);
      if (!shortcut) return;
      if (shortcut.type === "toggle-sidebar") {
        // Below 1024 px the sidebar isn't on screen: don't change it invisibly.
        if (!window.matchMedia(DESKTOP_QUERY).matches) return;
        event.preventDefault();
        setCollapsed((current) => !current);
        return;
      }
      const item = ITEMS[shortcut.index];
      if (!item) return;
      event.preventDefault();
      router.push(item.href);
    }

    window.addEventListener("keydown", onKeyDown);
    // Shortcuts only work once hydrated; E2E waits for this marker before pressing keys.
    document.documentElement.dataset.navShortcuts = "ready";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      delete document.documentElement.dataset.navShortcuts;
    };
  }, [router]);

  return (
    <>
      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
        <Sidebar
          items={ITEMS}
          pathname={pathname}
          collapsed={collapsed}
          onToggle={() => setCollapsed((current) => !current)}
          className="h-full"
        />
      </div>
      <div className="lg:hidden">
        <BottomNav items={ITEMS} pathname={pathname} className="bo-bottomnav--fixed" />
      </div>
    </>
  );
}
