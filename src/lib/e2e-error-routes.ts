/**
 * Test-only routes that force an error (C8): `/e2e/error` (inside the shell) and
 * `/e2e/root-error` (outside it). Two locks keep them out of production:
 *
 * 1. Build time: their files are `page.e2e.tsx`, and Next only treats `e2e.tsx` as a page
 *    extension when `E2E_ERROR_ROUTES=1` (`next.config.ts`). Any other build, production
 *    included, does not contain the routes at all, so they answer 404. Setting the flag on
 *    Vercel fails the build, and CI checks the build output (`scripts/check-no-e2e-routes.mjs`).
 * 2. Run time: even inside a build that has them, they call `notFound()` unless the flag is set.
 *
 * The smoke test checks that both URLs answer 404 in production.
 */
export const E2E_ERROR_ROUTES_FLAG = "E2E_ERROR_ROUTES";

/** The page extension that only exists in E2E builds. */
export const E2E_PAGE_EXTENSION = "e2e.tsx";

/** Next's default page extensions. */
const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** Path prefix of every test-only route. */
export const E2E_ROUTE_PREFIX = "/e2e/";

/** Thrown by the test routes; the E2E specs assert it never reaches the browser. */
export const E2E_ERROR_MESSAGE = "E2E forced error: this message must never reach the client";

/** Cookie that makes `/e2e/error` throw (the spec clears it to test "Reintentar"). */
export const E2E_ERROR_COOKIE = "bo_e2e_error";

type Env = Record<string, string | undefined>;

export function e2eErrorRoutesEnabled(env: Env = process.env): boolean {
  return env[E2E_ERROR_ROUTES_FLAG] === "1" && env.VERCEL !== "1";
}

/** `pageExtensions` for next.config.ts. Throws on Vercel with the flag set: it must never ship. */
export function pageExtensionsFor(env: Env = process.env): string[] {
  const flagged = env[E2E_ERROR_ROUTES_FLAG] !== undefined && env[E2E_ERROR_ROUTES_FLAG] !== "";
  if (flagged && env.VERCEL === "1") {
    throw new Error(
      `${E2E_ERROR_ROUTES_FLAG} must not be set on Vercel: it adds test-only routes.`,
    );
  }
  // The longer extension goes first, so `page.e2e.tsx` is read as `page` + `e2e.tsx`.
  return e2eErrorRoutesEnabled(env)
    ? [E2E_PAGE_EXTENSION, ...DEFAULT_PAGE_EXTENSIONS]
    : DEFAULT_PAGE_EXTENSIONS;
}
