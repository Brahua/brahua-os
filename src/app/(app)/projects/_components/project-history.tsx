"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

type ProjectHistoryProps = {
  /** Projects inside (Terminado and Cancelado). Hidden when there are none. */
  count: number;
  /** The history groups, rendered on the server. */
  children: React.ReactNode;
};

/**
 * "Historial": finished and canceled projects, folded by default (progressive disclosure), with
 * the same heading-with-a-disclosure-button pattern as "Archivadas" in Áreas.
 */
export function ProjectHistory({ count, children }: ProjectHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const ids = useId();
  if (count === 0) return null;

  const panelId = `${ids}-panel`;
  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h2 id={`${ids}-title`} className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-history-toggle
          onClick={() => setExpanded((value) => !value)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{PROJECTS_COPY.historyTitle}</span>
            <span className="bo-section-label__count">{count}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h2>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-6">
        <p className="bo-text-body-sm text-text-secondary">{PROJECTS_COPY.historyHelp}</p>
        {children}
      </div>
    </section>
  );
}
