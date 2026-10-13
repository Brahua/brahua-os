// What `weekly-review` offers other modules (SPEC-weekly-review "Contratos"). Server-only; the only
// file besides `routes.ts` that the composition root `src/lib/review-extensions.ts` reads.
//
// `getReviewInvite(now)` (for `today` and `goals`, through the root): the week the invitation
// offers to close, or null outside the window (Sunday 18:00 → Monday 23:59, Lima) or when that
// week is already closed. The card (`components/review-invite-card.tsx`) is client-safe.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { selectReviewRow } from "./queries";
import { reviewStepPath } from "./routes";
import { inviteWeek, reviewInvite } from "./week";

export { ReviewInviteCard } from "./components/review-invite-card";

/** The invitation: the week to close and where the card leads. */
export type ReviewInvite = { weekStart: string; href: string };

/** The invitation at `now`, reading whether the week is closed from `db`. Trusts its caller. */
export async function selectReviewInvite(db: Database, now: Date): Promise<ReviewInvite | null> {
  const week = inviteWeek(now);
  // Outside the window: no query at all.
  if (week === null) return null;
  const closed = (await selectReviewRow(db, week)) !== null;
  const invite = reviewInvite(now, closed);
  return invite ? { weekStart: invite.weekStart, href: reviewStepPath(1, invite.weekStart) } : null;
}

/** The invitation at `now` (the page's one instant), or null. Checks the owner first. */
export async function getReviewInvite(now: Date): Promise<ReviewInvite | null> {
  await requireOwner();
  return selectReviewInvite(getDb(), now);
}
