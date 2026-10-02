import type { LucideIcon } from "lucide-react";
import { Icon, SectionLabel } from "@/design-system";
import { VIEWS_COPY } from "@/modules/tasks/views-copy";

type ViewHeadingProps = {
  /** tabIndex -1: focus lands here when the last row leaves (the list's `fallbackFocusId`). */
  id: string;
  title: string;
  /** The tasks the view shows right now (none: no count). */
  count: number;
  help?: React.ReactNode;
};

/**
 * The heading of a view of /tasks with its count ("Hoy 3", read "Hoy: 3 tareas") and, under it,
 * what the view shows.
 */
export function ViewHeading({ id, title, count, help }: ViewHeadingProps) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel
        id={id}
        as="h2"
        tabIndex={-1}
        title={title}
        className="outline-none"
        // One name for the heading ("Hoy: 3 tareas"): separate spans would be read run together
        // or with a stray space depending on the engine.
        aria-label={count > 0 ? `${title}${VIEWS_COPY.countHidden(count)}` : undefined}
        count={count > 0 ? <span aria-hidden>{count}</span> : undefined}
      />
      {help ? <p className="bo-text-body-sm text-text-secondary">{help}</p> : null}
    </div>
  );
}

type ViewEmptyProps = {
  icon: LucideIcon;
  title: string;
  /** A data attribute value to find it (`data-view-empty`). */
  view: string;
  children: React.ReactNode;
};

/** The empty state of a view: an icon, what it means and what to do. */
export function ViewEmpty({ icon, title, view, children }: ViewEmptyProps) {
  return (
    <div className="bo-card max-w-160 items-start" data-view-empty={view}>
      <Icon icon={icon} size="xl" className="text-text-secondary" />
      <h3 className="bo-text-title">{title}</h3>
      {children}
    </div>
  );
}
