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
  /** Accessible names of the two nav landmarks (they must be unique on the page). */
  labels?: { main: string; footer: string };
  className?: string;
};

/**
 * Desktop sidebar (Claude Design `patterns/Navigation/Sidebar`): 240 px, or 72 px collapsed with
 * a tooltip per item. Items are links; the current one is a raised key (`aria-current="page"`).
 * Keyboard shortcuts live in `AppNav`; this component only shows them.
 * The root is a `<header>`: at the top level it is the page's banner landmark (brand, capture,
 * navigation), so nothing in it is left outside a landmark.
 */
export function Sidebar({
  items,
  pathname,
  collapsed,
  onToggle,
  onCapture,
  labels = { main: NAV_COPY.mainNav, footer: NAV_COPY.footerNav },
  className,
}: SidebarProps) {
  const main = items.filter((item) => item.group === "main");
  const footer = items.filter((item) => item.group === "footer");
  const toggleLabel = collapsed ? NAV_COPY.expandSidebar : NAV_COPY.collapseSidebar;

  const renderItem = (item: NavItem) => {
    const link = (
      <Link
        key={item.id}
        href={item.href}
        className="bo-navitem"
        aria-current={isActiveHref(item.href, pathname) ? "page" : undefined}
        // The label is hidden while collapsed, so the name can't come from the content.
        aria-label={item.label}
        aria-keyshortcuts={item.shortcut}
      >
        <Icon icon={item.icon} />
        <span className="bo-navitem__label">{item.label}</span>
        {item.shortcut ? <Kbd keys={item.shortcut} aria-hidden /> : null}
      </Link>
    );
    return collapsed ? (
      <Tooltip key={item.id} label={item.label} shortcut={item.shortcut} decorative>
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
        <Tooltip label={toggleLabel} shortcut="[" decorative>
          <button
            type="button"
            className="bo-navitem bo-sidebar__toggle"
            aria-label={toggleLabel}
            aria-keyshortcuts="["
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
      >
        <Icon icon={Plus} size="lg" />
        <span className="bo-sidebar__capture-label bo-hide-collapsed">{NAV_COPY.capture}</span>
        {onCapture ? (
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
