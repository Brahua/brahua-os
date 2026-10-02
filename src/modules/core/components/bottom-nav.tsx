"use client";

import { Ellipsis, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";
import { isActiveHref, splitBottomNav, type NavItem } from "@/lib/modules";
import { NAV_COPY } from "../copy";
import { CaptureKey } from "./capture-key";

// Only fetched when some section doesn't fit (rendered below only with overflow).
const MoreSheet = dynamic(() => import("./more-sheet").then((chunk) => chunk.MoreSheet));

// Cells of the 5-column bar: links fill 1, 2, 4 and 5; the capture key is always in the middle.
// Literal class names so Tailwind generates them.
const LINK_CELLS = ["col-start-1", "col-start-2", "col-start-4", "col-start-5"] as const;

type BottomNavProps = {
  items: readonly NavItem[];
  pathname: string;
  /**
   * Opens quick capture with the key that was pressed. Without it the capture key is shown as
   * not available yet (no capture provider registered).
   */
  onCapture?: (trigger: HTMLElement) => void;
  /** Fetches the capture's code ahead (the key is pointed at, focused or touched). */
  onCapturePreload?: () => void;
  /** Accessible name of the nav landmark (it must be unique on the page). */
  label?: string;
  className?: string;
  ref?: React.Ref<HTMLElement>;
};

/**
 * Phone bottom bar (Claude Design `patterns/Navigation/BottomNav`): up to 4 sections around the
 * orange capture key. With more than 4, the last cell is "Más", a sheet with the rest.
 * The current section is marked with `aria-current="page"`, bolder text and a dot (not only
 * color). Labels truncate on narrow screens; the full name stays in the link's name.
 */
export function BottomNav({
  items,
  pathname,
  onCapture,
  onCapturePreload,
  label = NAV_COPY.mainNav,
  className,
  ref,
}: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const { primary, overflow } = splitBottomNav(items);
  const currentHidden = overflow.find((item) => isActiveHref(item.href, pathname));

  const renderLink = (item: NavItem, index: number) => (
    <Link
      key={item.id}
      href={item.href}
      className={cn("bo-bottomnav__item row-start-1", LINK_CELLS[index])}
      aria-current={isActiveHref(item.href, pathname) ? "page" : undefined}
      aria-label={item.label}
    >
      <Icon icon={item.icon} size="md" />
      <span className="bo-bottomnav__label">{item.label}</span>
    </Link>
  );

  return (
    <nav ref={ref} aria-label={label} className={cn("bo-bottomnav", className)}>
      {/* DOM order = visual order (WCAG 1.3.2, 2.4.3): the first two links, the capture key in
          the middle cell, then the rest and "Más". */}
      {primary.slice(0, 2).map((item, index) => renderLink(item, index))}

      <CaptureKey
        placement="top"
        className="bo-key--icon bo-key--lg bo-bottomnav__capture"
        anchorClassName="col-start-3 row-start-1 justify-self-center"
        onCapture={onCapture}
        onPreload={onCapturePreload}
      >
        <Icon icon={Plus} size="xl" />
      </CaptureKey>

      {primary.slice(2).map((item, index) => renderLink(item, index + 2))}

      {overflow.length > 0 ? (
        <>
          <button
            ref={moreButton}
            type="button"
            className={cn("bo-bottomnav__item row-start-1", LINK_CELLS[primary.length])}
            aria-haspopup="dialog"
            // A button isn't the page: the current hidden section goes in its name instead of
            // aria-current, and `data-active` gives it the current-item look.
            aria-label={currentHidden ? NAV_COPY.moreCurrent(currentHidden.label) : undefined}
            data-active={currentHidden ? "" : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <Icon icon={Ellipsis} size="md" />
            <span className="bo-bottomnav__label">{NAV_COPY.more}</span>
          </button>
          <MoreSheet
            items={overflow}
            pathname={pathname}
            open={moreOpen}
            onOpenChange={setMoreOpen}
            returnFocusRef={moreButton}
          />
        </>
      ) : null}
    </nav>
  );
}
