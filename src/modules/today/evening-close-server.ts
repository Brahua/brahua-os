// evening-close-ritual, the server's side: whether the page is read in the close window. Only the
// page calls it. In an E2E build only (same guard as the test-only error routes, never in
// production) the `bo_e2e_evening` cookie decides instead of the hour, so no E2E spec depends on
// the hour it runs at (a run at night would draw the close on every board) and the close's own
// spec is deterministic.
import { cookies } from "next/headers";
import { e2eErrorRoutesEnabled } from "@/lib/e2e-error-routes";
import { E2E_EVENING_COOKIE, isEveningClose } from "./evening-close";

/** Whether the board is read from 20:00 (Lima): the close of the day replaces the header's line. */
export async function isEveningCloseFor(now: Date): Promise<boolean> {
  if (e2eErrorRoutesEnabled()) {
    return (await cookies()).get(E2E_EVENING_COOKIE)?.value === "on";
  }
  return isEveningClose(now);
}
