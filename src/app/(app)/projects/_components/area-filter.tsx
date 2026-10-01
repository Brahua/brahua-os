import { LayoutGrid } from "lucide-react";
import Link from "next/link";
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
 * and the "on" look of a key. The chips wrap at every width.
 *
 * No prefetch: each chip is the same dynamic page with its own query, and prefetching them all
 * on every visit costs more than the click it saves for a single user.
 */
export function AreaFilter({ options, selectedId }: AreaFilterProps) {
  return (
    <nav aria-label={PROJECTS_COPY.filterLabel}>
      <ul className="bo-filter-chips">
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
          <li key={option.id} className="min-w-0 max-w-full">
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
                // Long names are cut on screen; the full one shows on hover.
                title={option.name}
                className="max-w-full [&>span:last-child]:truncate"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
