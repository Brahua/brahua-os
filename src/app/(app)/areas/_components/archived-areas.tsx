"use client";

import { ArchiveRestore, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { AreaTag, Icon, Key, ListRow } from "@/design-system";
import { cn } from "@/lib/cn";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";

type ArchivedAreasProps = {
  areas: LifeAreaSummary[];
  onUnarchive: (area: LifeAreaSummary) => void;
};

/**
 * The archived areas, folded by default (progressive disclosure): a heading with a disclosure
 * button and the count. Archived areas are read-only; "Desarchivar" brings one back to the end
 * of the list, where it can be edited again. Hidden when there are none.
 */
export function ArchivedAreas({ areas, onUnarchive }: ArchivedAreasProps) {
  const [expanded, setExpanded] = useState(false);
  const ids = useId();
  if (areas.length === 0) return null;

  const panelId = `${ids}-panel`;
  return (
    <section aria-labelledby={`${ids}-title`} className="flex max-w-160 flex-col gap-3">
      <h2 id={`${ids}-title`} className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-archived-toggle
          onClick={() => setExpanded((value) => !value)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{AREAS_COPY.archivedTitle}</span>
            <span className="bo-section-label__count">{areas.length}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h2>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-3">
        <p className="bo-text-body-sm text-text-secondary">{AREAS_COPY.archivedHelp}</p>
        <ul aria-label={AREAS_COPY.archivedList} className="bo-list">
          {areas.map((area) => (
            <li key={area.id} data-archived-row={area.id} className="flex">
              <ListRow
                title={
                  <AreaTag
                    area={area.color}
                    icon={area.icon}
                    label={area.name}
                    variant="large"
                    className="max-w-full [&>span:last-child]:line-clamp-2 [&>span:last-child]:break-words"
                    title={area.name}
                  />
                }
                trailing={
                  <Key
                    variant="ghost"
                    icon={ArchiveRestore}
                    aria-label={AREAS_COPY.unarchiveRow(area.name)}
                    data-area-unarchive={area.id}
                    onClick={() => onUnarchive(area)}
                  >
                    <span className="max-sm:sr-only">{AREAS_COPY.unarchive}</span>
                  </Key>
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
