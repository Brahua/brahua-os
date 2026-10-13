// The instant the invitation reads, the server's side. In an E2E build only (same guard as the
// test-only error routes, never in production) the `bo_e2e_invite` cookie decides instead of the
// clock: with it `on` the card shows (a fixed Sunday 19:00 in Lima), without it the clock is fixed
// on a Wednesday, so no E2E spec on Hoy or Metas depends on the day and hour CI runs it
// (a Sunday evening or a Monday would draw the card on both screens).
import "server-only";
import { cookies } from "next/headers";
import { e2eErrorRoutesEnabled } from "@/lib/e2e-error-routes";

export const E2E_INVITE_COOKIE = "bo_e2e_invite";

/** Sunday 2026-10-11, 19:00 in Lima (the week of Monday 2026-10-05 is the one offered). */
export const E2E_INVITE_ON = new Date("2026-10-12T00:00:00Z");
/** Wednesday 2026-10-14, noon in Lima: outside the window. */
export const E2E_INVITE_OFF = new Date("2026-10-14T17:00:00Z");

/** `now`, or in an E2E build the fixed instant the cookie picks. */
export async function inviteInstantFor(now: Date): Promise<Date> {
  if (!e2eErrorRoutesEnabled()) return now;
  return (await cookies()).get(E2E_INVITE_COOKIE)?.value === "on" ? E2E_INVITE_ON : E2E_INVITE_OFF;
}
