import Link from "next/link";
import { Key } from "@/design-system";
import { REVIEW_COPY } from "../review-copy";
import { reviewStepPath } from "../routes";

type ReviewInviteCardProps = {
  /** The Monday of the week the invitation offers to close. */
  weekStart: string;
};

/**
 * The invitation to close the week (SPEC-weekly-review "Invitación"): a calm card on Hoy and Metas
 * from Sunday 18:00 to Monday 23:59 (Lima), until that week is closed. It says «nuevo comienzo»,
 * never what is left undone, and has no animation. Client-safe (no server-only imports): the
 * composition root `src/lib/review-extensions.ts` decides whether to render it.
 */
export function ReviewInviteCard({ weekStart }: ReviewInviteCardProps) {
  return (
    <section
      aria-labelledby="review-invite-title"
      data-review-invite=""
      className="flex max-w-160 flex-col items-start gap-3 rounded-md border border-border-subtle bg-surface-raised p-4"
    >
      <h2 id="review-invite-title" className="bo-text-title">
        {REVIEW_COPY.inviteTitle}
      </h2>
      <p className="bo-text-body-sm text-text-secondary">{REVIEW_COPY.inviteText}</p>
      <Key asChild variant="signal">
        <Link href={reviewStepPath(1, weekStart)} data-review-invite-link="">
          {REVIEW_COPY.inviteAction}
        </Link>
      </Key>
    </section>
  );
}
