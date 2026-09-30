"use client";

import { ChevronRight } from "lucide-react";
import { Icon, ListRow, Sheet } from "@/design-system";
import { isActiveHref, type NavItem } from "@/lib/modules";
import { NAV_COPY } from "../copy";

type MoreSheetProps = {
  items: readonly NavItem[];
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The "Más" button: focus returns there on close. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

/** The sections that don't fit in the bottom bar. Loaded only when there are any. */
export function MoreSheet({ items, pathname, open, onOpenChange, returnFocusRef }: MoreSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={NAV_COPY.more}
      returnFocusRef={returnFocusRef}
    >
      <nav aria-label={NAV_COPY.moreSections}>
        <div className="bo-list">
          {items.map((item) => {
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
                onClick={() => onOpenChange(false)}
              />
            );
          })}
        </div>
      </nav>
    </Sheet>
  );
}
