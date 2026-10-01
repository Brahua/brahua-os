"use client";

import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { AreaTag, Icon } from "@/design-system";
import type { AreaFilterOption } from "@/modules/projects/project-list";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

type AreaFilterProps = {
  options: readonly AreaFilterOption[];
  /** Id of the chip on (`?area=<slug>`), or null for "Todas". */
  selectedId: string | null;
};

/**
 * Area filter of the projects list: links that set `?area=<slug>` (so the filter lives in the
 * URL and survives a reload or a shared link). The current chip carries `aria-current="page"`
 * and the "on" look of a key. On the phone the chips scroll sideways in one row, and the row
 * starts scrolled to the current chip (only the row moves, never the page).
 */
export function AreaFilter({ options, selectedId }: AreaFilterProps) {
  const row = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const list = row.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    const chip = current.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (chip.left >= box.left && chip.right <= box.right) return;
    list.scrollLeft += chip.left - box.left - (box.width - chip.width) / 2;
  }, [selectedId]);

  return (
    <nav aria-label={PROJECTS_COPY.filterLabel}>
      <ul ref={row} className="bo-filter-chips">
        <li>
          <Link
            href="/projects"
            scroll={false}
            prefetch={false}
            aria-current={selectedId === null ? "page" : undefined}
            className="bo-filter-chip"
          >
            <span className="bo-area-tag bo-area-tag--chip">
              <Icon icon={LayoutGrid} size="xs" />
              <span>{PROJECTS_COPY.allAreas}</span>
            </span>
          </Link>
        </li>
        {options.map((option) => (
          <li key={option.id}>
            <Link
              href={`/projects?area=${encodeURIComponent(option.slug)}`}
              scroll={false}
              prefetch={false}
              aria-current={selectedId === option.id ? "page" : undefined}
              className="bo-filter-chip"
            >
              <AreaTag
                area={option.color}
                icon={option.icon}
                label={option.name}
                variant="chip"
                className="max-w-60 [&>span:last-child]:truncate"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
