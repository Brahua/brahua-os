"use client";

import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import Link from "next/link";
import { Icon, Kbd, Tooltip } from "@/design-system";
import { cn } from "@/lib/cn";
import { isActiveHref, type NavItem } from "@/lib/modules";
import { NAV_COPY } from "../copy";
import { CaptureKey } from "./capture-key";

type SidebarProps = {
  items: readonly NavItem[];
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Opens quick capture. Without it the capture key is shown as not available yet. */
  onCapture?: () => void;
  /**
   * Show keyboard shortcuts (Kbd hints, `aria-keyshortcuts`). Off when the owner turned the
   * single-key shortcuts off (WCAG 2.1.4), and in demos where the keys aren't bound.
   */
  shortcuts?: boolean;
  /** Accessible names of the two nav landmarks (they must be unique on the page). */
  labels?: { main: string; footer: string };
  className?: string;
};

/**
 * Desktop sidebar (Claude Design `patterns/Navigation/Sidebar`): 240 px, or 72 px collapsed with
 * a tooltip per item. Items are links; the current one is a raised key (`aria-current="page"`).
 * Keyboard shortcuts live in `AppNav`; this component only shows them (when `shortcuts`).
 * The root is a `<header>`: at the top level it is the page's banner landmark (brand, capture,
 * navigation), so nothing in it is left outside a landmark.
 */
export function Sidebar({
  items,
  pathname,
  collapsed,
  onToggle,
  onCapture,
  shortcuts = true,
  labels = { main: NAV_COPY.mainNav, footer: NAV_COPY.footerNav },
  className,
}: SidebarProps) {
  const main = items.filter((item) => item.group === "main");
  const footer = items.filter((item) => item.group === "footer");
  const toggleLabel = collapsed ? NAV_COPY.expandSidebar : NAV_COPY.collapseSidebar;
  const toggleShortcut = shortcuts ? "[" : undefined;

  const renderItem = (item: NavItem) => {
    const shortcut = shortcuts ? item.shortcut : undefined;
    const link = (
      <Link
        key={item.id}
        href={item.href}
        className="bo-navitem"
        aria-current={isActiveHref(item.href, pathname) ? "page" : undefined}
        // The label is hidden while collapsed, so the name can't come from the content.
        aria-label={item.label}
        aria-keyshortcuts={shortcut}
      >
        <Icon icon={item.icon} />
        <span className="bo-navitem__label">{item.label}</span>
        {shortcut ? <Kbd keys={shortcut} aria-hidden /> : null}
      </Link>
    );
    return collapsed ? (
      <Tooltip key={item.id} label={item.label} shortcut={shortcut} decorative>
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  return (
    <header className={cn("bo-sidebar", collapsed && "is-collapsed", className)}>
      <div className="bo-sidebar__header">
        <span className="bo-sidebar__brand">{NAV_COPY.brand}</span>
        <Tooltip label={toggleLabel} shortcut={toggleShortcut} decorative>
          <button
            type="button"
            className="bo-navitem bo-sidebar__toggle"
            aria-label={toggleLabel}
            aria-keyshortcuts={toggleShortcut}
            onClick={onToggle}
          >
            <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
          </button>
        </Tooltip>
      </div>

      <CaptureKey
        placement="right"
        className="bo-sidebar__capture"
        anchorClassName="justify-center"
        onCapture={onCapture}
        shortcut={shortcuts}
      >
        <Icon icon={Plus} size="lg" />
        <span className="bo-sidebar__capture-label bo-hide-collapsed">{NAV_COPY.capture}</span>
        {onCapture && shortcuts ? (
          <Kbd keys="C" tone="signal" className="bo-hide-collapsed" aria-hidden />
        ) : null}
      </CaptureKey>

      <nav aria-label={labels.main} className="flex flex-col gap-1">
        {main.map(renderItem)}
      </nav>
      {footer.length > 0 ? (
        <nav
          aria-label={labels.footer}
          className="mt-auto flex flex-col gap-1 border-t border-divider pt-3.5"
        >
          {footer.map(renderItem)}
        </nav>
      ) : null}
    </header>
  );
}
