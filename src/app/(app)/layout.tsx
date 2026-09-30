import { requireOwner } from "@/lib/auth";

/**
 * Protected area: without an owner session every route redirects to /login.
 * Pages call `requireOwner()` too: a layout alone does not stop a page from rendering.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  return children;
}
