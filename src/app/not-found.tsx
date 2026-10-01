import { getSessionCookie } from "better-auth/cookies";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getOwnerSession, type OwnerSession } from "@/lib/auth";
import { describeError } from "@/lib/owner-action";
import { AppShell } from "@/modules/core/components/app-shell";
import { NotFoundScreen } from "@/modules/core/components/not-found-screen";
import { STATUS_COPY } from "@/modules/core/copy";

export const metadata: Metadata = {
  title: STATUS_COPY.notFound.title,
  robots: { index: false, follow: false },
};

/**
 * The owner session if there is one. Without a session cookie (any visitor, the smoke test) it
 * never touches the database. If the lookup fails (e.g. the database is down), it logs one line
 * without any message text and answers "no session": the signed-out 404 still helps.
 */
async function sessionFor404(): Promise<OwnerSession | null> {
  if (!getSessionCookie(await headers())) return null;
  try {
    return await getOwnerSession();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "not_found_session_failed",
        ...describeError(error),
      }),
    );
    return null;
  }
}

/**
 * Every URL that matches no route (and `notFound()` outside `(app)`). It renders in the root
 * layout, so it checks the session itself: the owner gets the shell (navigation included) and a
 * way back to Hoy; anyone else, a bare page that points to the login. Unlike a protected route,
 * a missing one answers 404 even without a session: route names are not secret here, and the
 * smoke test relies on it (`/e2e/*` must not exist in production).
 */
export default async function NotFound() {
  const session = await sessionFor404();

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
