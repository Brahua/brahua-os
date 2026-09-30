"use client";

import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Icon, ListRow, Sheet } from "@/design-system";
import { cn } from "@/lib/cn";
import { isActiveHref, splitBottomNav, type NavItem } from "@/lib/modules";
import { NAV_COPY } from "../copy";
import { CaptureKey } from "./capture-key";

// Cells of the 5-column bar: links fill 1, 2, 4 and 5; the capture key is always in the middle.
// Literal class names so Tailwind generates them.
const LINK_CELLS = ["col-start-1", "col-start-2", "col-start-4", "col-start-5"] as const;

type BottomNavProps = {
  items: readonly NavItem[];
  pathname: string;
  /** Opens quick capture. Without it the capture key is shown as not available yet. */
  onCapture?: () => void;
  /** Accessible name of the nav landmark (it must be unique on the page). */
  label?: string;
  className?: string;
};

/**
 * Phone bottom bar (Claude Design `patterns/Navigation/BottomNav`): up to 4 sections around the
 * orange capture key. With more than 4, the last cell is "Más", a sheet with the rest.
 */
export function BottomNav({
  items,
  pathname,
  onCapture,
  label = NAV_COPY.mainNav,
  className,
}: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { primary, overflow } = splitBottomNav(items);
  const moreActive = overflow.some((item) => isActiveHref(item.href, pathname));

  return (
    <nav aria-label={label} className={cn("bo-bottomnav", className)}>
      {primary.map((item, index) => (
        <Link
          key={item.id}
          href={item.href}
          className={cn("bo-bottomnav__item row-start-1", LINK_CELLS[index])}
          aria-current={isActiveHref(item.href, pathname) ? "page" : undefined}
        >
          <Icon icon={item.icon} size="md" />
          {item.label}
        </Link>
      ))}

      <CaptureKey
        placement="top"
        className="bo-key--icon bo-key--lg bo-bottomnav__capture"
        anchorClassName="col-start-3 row-start-1 justify-self-center"
        onCapture={onCapture}
      >
        <Icon icon={Plus} size="xl" />
      </CaptureKey>

      {overflow.length > 0 ? (
        <>
          <button
            type="button"
            className={cn("bo-bottomnav__item row-start-1", LINK_CELLS[primary.length])}
            aria-haspopup="dialog"
            // Styled like the current page when the page is one of the hidden sections.
            aria-current={moreActive ? "page" : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <Icon icon={Ellipsis} size="md" />
            {NAV_COPY.more}
          </button>
          <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={NAV_COPY.more}>
            <div className="bo-list">
              {overflow.map((item) => {
                const active = isActiveHref(item.href, pathname);
                return (
                  <ListRow
                    key={item.id}
                    href={item.href}
                    title={item.label}
                    leading={<Icon icon={item.icon} />}
                    trailing={<Icon icon={ChevronRight} size="sm" />}
                    selected={active}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                  />
                );
              })}
            </div>
          </Sheet>
        </>
      ) : null}
    </nav>
  );
}
