import { connection } from "next/server";
import { notFound } from "next/navigation";
import { E2E_ERROR_MESSAGE, e2eErrorRoutesEnabled } from "@/lib/e2e-error-routes";

/**
 * TEST ONLY (E2E builds; see src/lib/e2e-error-routes.ts). Always throws outside the shell, so the
 * root `error.tsx` renders (as for an error in the `(app)` layout). No session needed.
 */
export default async function E2eRootErrorPage() {
  // Render on each request, never at build time (the throw would fail the build).
  await connection();
  if (!e2eErrorRoutesEnabled()) notFound();
  throw new Error(E2E_ERROR_MESSAGE);
}
