import { cookies } from "next/headers";
import { AppNav } from "@/modules/core/components/app-nav";
import { SessionRefresher } from "@/modules/core/components/session-refresher";
import { NAV_COPY } from "@/modules/core/copy";
import {
  areShortcutsEnabled,
  isSidebarCollapsed,
  SHORTCUTS_COOKIE,
  SIDEBAR_COOKIE,
} from "@/modules/core/nav-preferences";

/**
 * The signed-in shell: sidebar from 1024 px, fixed bottom bar below. Pages render inside `<main>`
 * and lay out their own content width (up to `--content-max`).
 *
 * `<main>` pads itself with the safe-area insets; the root layout sets viewport-fit=cover and
 * paints the strip behind the iOS status bar.
 *
 * Server Component that reads the navigation cookies. It never checks the session: callers do
 * (the `(app)` layout with `requireOwner()`, the root 404 with `getOwnerSession()`).
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
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
