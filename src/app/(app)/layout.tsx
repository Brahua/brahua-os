import { requireOwner } from "@/lib/auth";
import { CaptureRoot } from "@/lib/capture-providers";
import { AppShell } from "@/modules/core/components/app-shell";

/**
 * Protected area: without an owner session every route redirects to /login.
 * Pages call `requireOwner()` too: a layout alone does not stop a page from rendering.
 * The shell (navigation, `<main>`) lives in `AppShell`, shared with the root 404 page.
 * viewport-fit=cover comes from the root layout (every page draws under the notch).
 * `CaptureRoot` hands the shell the quick capture of whichever module registered it (`tasks`),
 * without `core` importing that module (src/lib/quick-capture.ts).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  return (
    <CaptureRoot>
      <AppShell>{children}</AppShell>
    </CaptureRoot>
  );
}
