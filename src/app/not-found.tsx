import type { Metadata } from "next";
import { getOwnerSession, type OwnerSession } from "@/lib/auth";
import { AppShell } from "@/modules/core/components/app-shell";
import { NotFoundScreen } from "@/modules/core/components/not-found-screen";
import { STATUS_COPY } from "@/modules/core/copy";

export const metadata: Metadata = {
  title: STATUS_COPY.notFound.title,
  robots: { index: false, follow: false },
};

/**
 * Every URL that matches no route (and `notFound()` outside `(app)`). It renders in the root
 * layout, so it checks the session itself: the owner gets the shell (navigation included) and a
 * way back to Hoy; anyone else, a bare page that points to the login. Unlike a protected route,
 * a missing one answers 404 even without a session: route names are not secret here, and the
 * smoke test relies on it (`/e2e/*` must not exist in production).
 */
export default async function NotFound() {
  let session: OwnerSession | null = null;
  try {
    session = await getOwnerSession();
  } catch {
    // The session lookup failed (e.g. the database is down): the signed-out 404 still helps.
  }

  if (session) {
    return (
      <AppShell>
        <NotFoundScreen signedIn />
      </AppShell>
    );
  }
  return (
    <main className="flex flex-1 flex-col">
      <NotFoundScreen signedIn={false} />
    </main>
  );
}
