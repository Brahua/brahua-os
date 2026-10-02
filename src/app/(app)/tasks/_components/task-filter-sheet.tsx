"use client";

import { Check } from "lucide-react";
import { useRef } from "react";
import { Icon, ListRow, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";

/** One option of a filter: a link to the view with that filter (it lives in the URL). */
export type FilterOption = {
  /** null: "all". */
  id: string | null;
  href: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
};

export type TaskFilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Name of the options' list. */
  listLabel: string;
  options: readonly FilterOption[];
  selectedId: string | null;
  /** Shown under the options (e.g. why there are none). */
  note?: React.ReactNode;
  /** Called with the option picked, right before the link navigates. */
  onPick: (id: string | null) => void;
  /** Called once the sheet has closed and the page is no longer hidden (to announce). */
  onClosed: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

/**
 * The options of a filter of "Todas" (the pattern of the projects' area filter): bottom sheet on
 * the phone, side panel on the desktop. Each option is a link; the current one has
 * `aria-current="page"`, a check and focus when the sheet opens. No prefetch: every option is the
 * same dynamic page with another query.
 */
export function TaskFilterSheet({
  open,
  onOpenChange,
  title,
  listLabel,
  options,
  selectedId,
  note,
  onPick,
  onClosed,
  returnFocusRef,
}: TaskFilterSheetProps) {
  const isDesktop = useIsDesktop();
  const currentRef = useRef<HTMLAnchorElement>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={title}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      initialFocusRef={currentRef}
    >
      <ul className="bo-list" aria-label={listLabel}>
        {options.map((option) => {
          const current = option.id === selectedId;
          return (
            <li key={option.id ?? "all"} className="flex">
              <ListRow
                href={option.href}
                scroll={false}
                prefetch={false}
                compact={isDesktop}
                selected={current}
                aria-current={current ? "page" : undefined}
                ref={current ? currentRef : undefined}
                onClick={() => {
                  onPick(option.id);
                  onOpenChange(false);
                }}
                title={option.title}
                subtitle={option.subtitle}
                trailing={current ? <Icon icon={Check} /> : undefined}
              />
            </li>
          );
        })}
      </ul>
      {note ? <p className="bo-text-body-sm mt-4 text-text-secondary">{note}</p> : null}
    </Sheet>
  );
}
