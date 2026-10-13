// Composition root of what `weekly-review` adds to the screens of other modules (W4): the
// invitation card at the top of Hoy (`/`) and Metas (`/goals`), so neither `today` nor `goals`
// imports `weekly-review` (eslint.config.mjs lets only src/lib and src/app do it). Like
// src/lib/goal-extensions.ts, the one place that knows the provider; but there is nothing to
// register: the two pages are the composition, they await `getReviewInviteSlot(now)` with their
// other reads and render the node it returns (null when there is no invitation). Decisión
// autónoma para revisar con el owner: no registry slot in `today` or `goals`, because the card is
// one fixed element of two known pages (a registry would add a contract for a single consumer).
//
// The provider is imported BY NAME, never a side-effect-only `import "…"` (package.json declares
// every JS module free of side effects: the bundler would drop it, see progress-sources.ts).
import "server-only";
import type { ReactNode } from "react";
import { getReviewInvite, ReviewInviteCard } from "@/modules/weekly-review/contracts";
import { inviteInstantFor } from "@/modules/weekly-review/invite-clock";

/**
 * The invitation card for the page's instant `now`, or null (outside Sunday 18:00 → Monday 23:59
 * Lima, or the week already closed). Call it with the page's other reads, after `requireOwner()`.
 */
export async function getReviewInviteSlot(now: Date): Promise<ReactNode> {
  const invite = await getReviewInvite(await inviteInstantFor(now));
  return invite ? <ReviewInviteCard weekStart={invite.weekStart} /> : null;
}
