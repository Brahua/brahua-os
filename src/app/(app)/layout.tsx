import { requireOwner } from "@/lib/auth";
import { AppShell } from "@/modules/core/components/app-shell";

/**
 * Protected area: without an owner session every route redirects to /login.
 * Pages call `requireOwner()` too: a layout alone does not stop a page from rendering.
 * The shell (navigation, `<main>`) lives in `AppShell`, shared with the root 404 page.
 * viewport-fit=cover comes from the root layout (every page draws under the notch).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  return <AppShell>{children}</AppShell>;
}
