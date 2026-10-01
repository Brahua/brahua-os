import { Lock } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/design-system";
import type { ActiveBlocker } from "@/modules/projects/dependency-input";
import { DEPENDENCIES_COPY } from "@/modules/projects/projects-copy";
import { projectPath } from "@/modules/projects/routes";

/**
 * The header's "Bloqueado por X, Y" (P4), each a link to that project. Only the blockers that
 * still block (neither done nor canceled): it clears by itself when the last one ends. Nothing
 * renders when none do. Server-renderable (no hooks).
 */
export function ProjectBlockedBy({ blockers }: { blockers: readonly ActiveBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <p className="bo-text-body-sm flex items-start gap-1.5 text-text-secondary" data-blocked-by>
      <Icon icon={Lock} size="sm" className="mt-0.5 shrink-0" />
      {/* Inline text inside: the spaces stay real (read as "Bloqueado por X, Y"). */}
      <span className="min-w-0 break-words">
        {DEPENDENCIES_COPY.blockedByPrefix}{" "}
        {blockers.map((blocker, index) => (
          <Fragment key={blocker.id}>
            {index > 0 ? ", " : null}
            <Link
              href={projectPath(blocker.id)}
              prefetch={false}
              className="rounded-sm text-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {blocker.name}
            </Link>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
