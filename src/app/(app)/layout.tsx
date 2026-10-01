import type { Viewport } from "next";
import { requireOwner } from "@/lib/auth";
import { AppShell } from "@/modules/core/components/app-shell";

// Draw under the notch and home indicator; the shell pads itself with the safe-area insets.
export const viewport: Viewport = { viewportFit: "cover" };

/**
 * Protected area: without an owner session every route redirects to /login.
 * Pages call `requireOwner()` too: a layout alone does not stop a page from rendering.
 * The shell (navigation, `<main>`) lives in `AppShell`, shared with the root 404 page.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  return <AppShell>{children}</AppShell>;
}
