"use client";

import { Check, LayoutGrid } from "lucide-react";
import { useRef } from "react";
import { AreaTag, Icon, ListRow, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { AreaFilterOption } from "@/modules/projects/project-list";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

export type AreaFilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: readonly AreaFilterOption[];
  /** Id of the area in the URL (`?area=<slug>`), or null for "Todas las áreas". */
  selectedId: string | null;
  /** Called with the option picked (null: all areas), right before the link navigates. */
  onPick: (id: string | null) => void;
  /** Called once the sheet has closed and the page is no longer hidden (to announce). */
  onClosed: () => void;
  /** The "Área: …" trigger, where focus goes back on close. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

/**
 * The options of the area filter: bottom sheet on the phone, side panel on desktop. Each option
 * is a link to `?area=<slug>` (the filter lives in the URL); the current one has
 * `aria-current="page"`, a check and focus when the sheet opens.
 *
 * No prefetch: every option is the same dynamic page with another query.
 */
export function AreaFilterSheet({
  open,
  onOpenChange,
  options,
  selectedId,
  onPick,
  onClosed,
  returnFocusRef,
}: AreaFilterSheetProps) {
  const isDesktop = useIsDesktop();
  const currentRef = useRef<HTMLAnchorElement>(null);
  const rows = [
    { id: null, href: "/projects", option: null },
    ...options.map((option) => ({
      id: option.id,
      href: `/projects?area=${encodeURIComponent(option.slug)}`,
      option,
    })),
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={PROJECTS_COPY.filterLabel}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      initialFocusRef={currentRef}
    >
      <ul className="bo-list" aria-label={PROJECTS_COPY.filterOptions}>
        {rows.map(({ id, href, option }) => {
          const current = id === selectedId;
          return (
            <li key={id ?? "all"} className="flex">
              <ListRow
                href={href}
                scroll={false}
                prefetch={false}
                compact={isDesktop}
                selected={current}
                aria-current={current ? "page" : undefined}
                // Focus starts on the current option (the sheet's initialFocusRef).
                ref={current ? currentRef : undefined}
                onClick={() => {
                  onPick(id);
                  onOpenChange(false);
                }}
                title={
                  option ? (
                    <AreaTag
                      area={option.color}
                      icon={option.icon}
                      label={option.name}
                      variant="large"
                      className="max-w-full [&>span:last-child]:truncate"
                    />
                  ) : (
                    <span className="bo-area-tag bo-area-tag--lg">
                      <Icon icon={LayoutGrid} />
                      <span>{PROJECTS_COPY.allAreasOption}</span>
                    </span>
                  )
                }
                subtitle={
                  option?.archived ? (
                    <>
                      {/* Heard as "Trabajo, Archivada", not "TrabajoArchivada". */}
                      <span className="sr-only">, </span>
                      {PROJECTS_COPY.archivedArea}
                    </>
                  ) : undefined
                }
                trailing={current ? <Icon icon={Check} /> : undefined}
              />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
