// Test-only owner for E2E, seeded in the throwaway database by global-setup.ts.
// Not a secret: it only ever exists in the disposable test Postgres.
export const E2E_OWNER = {
  email: "owner@brahua-os.test",
  password: "e2e owner password 2026",
} as const;

/** Signed-in browser state saved by auth.setup.ts and reused by the app specs. */
export const OWNER_STORAGE_STATE = "e2e/.auth/owner.json";

/** Stable per-test client IP, so the sign-in rate limit (5 per minute per IP) never leaks between tests. */
export function clientIp(workerIndex: number, retry: number, n: number): string {
  return `10.${workerIndex % 256}.${retry % 256}.${n % 256}`;
}

/** The home page's h1 is a greeting that depends on the time of day in Lima. */
export const HOME_HEADING = /^(Buenos días|Buenas tardes|Buenas noches)$/;
