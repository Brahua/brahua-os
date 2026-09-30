import type { Viewport } from "next";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { AppNav } from "@/modules/core/components/app-nav";
import { NAV_COPY } from "@/modules/core/copy";
import {
  areShortcutsEnabled,
  isSidebarCollapsed,
  SHORTCUTS_COOKIE,
  SIDEBAR_COOKIE,
} from "@/modules/core/nav-preferences";
import { SessionRefresher } from "./_components/session-refresher";

// Draw under the notch and home indicator; the shell pads itself with the safe-area insets.
export const viewport: Viewport = { viewportFit: "cover" };

/**
 * Protected area: without an owner session every route redirects to /login.
 * Pages call `requireOwner()` too: a layout alone does not stop a page from rendering.
 *
 * Shell: sidebar from 1024 px, fixed bottom bar below. Pages render inside `<main>` and lay out
 * their own content width (up to `--content-max`).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  const cookieStore = await cookies();
  const collapsed = isSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE)?.value);
  const shortcutsEnabled = areShortcutsEnabled(cookieStore.get(SHORTCUTS_COOKIE)?.value);

  return (
    <>
      <SessionRefresher />
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-key px-4 py-3 text-text shadow-key focus:not-sr-only focus:fixed focus:top-[max(1rem,env(safe-area-inset-top))] focus:left-[max(1rem,env(safe-area-inset-left))]"
      >
        {NAV_COPY.skipToContent}
      </a>
      <div className="flex flex-1">
        <AppNav initialCollapsed={collapsed} shortcutsEnabled={shortcutsEnabled} />
        <main
          id="content"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-(--shell-bottom-offset) pl-[env(safe-area-inset-left)] outline-none lg:pb-0"
        >
          {children}
        </main>
      </div>
    </>
  );
}
