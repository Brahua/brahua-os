import Link from "next/link";
import { GOALS_COPY } from "../goals-copy";
import type { GoalSourceLink } from "../goal-text";

/**
 * " · Correr": the habit or project a goal follows, a link to its page, right after the count
 * ("34 de 40 días · Correr", "62 % · Lanzar brahua-os"). Renders nothing for a manual goal.
 */
export function GoalSourceLinkText({ source }: { source: GoalSourceLink | null }) {
  if (!source) return null;
  return (
    <>
      {" · "}
      <Link
        href={source.href}
        aria-label={GOALS_COPY.sourceLinkLabel(source.kind, source.name)}
        data-goal-source={source.kind}
        className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {source.name}
      </Link>
    </>
  );
}
