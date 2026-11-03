import Link from "next/link";
import { SectionLabel } from "@/design-system";
import { cn } from "@/lib/cn";
import type { LinkingNote } from "../links";
import { NOTES_COPY as COPY } from "../copy";

/**
 * How the section's heading looks, to match its neighbours: `"label"` is the design system's
 * `SectionLabel` (projects, tasks and learning tracks), `"title"` the `bo-text-title` heading
 * (goals, habits and a note's page).
 */
export type BacklinksHeading = "label" | "title";

type NoteBacklinksProps = {
  /** The section's heading: «Enlazada desde» or «Aparece en 3 notas». */
  title: string;
  notes: readonly LinkingNote[];
  /** The heading's id (unique on the page). */
  headingId: string;
  /** Marks the section for tests (`data-<name>`). */
  marker: "note-linked-from" | "note-mentions";
  heading?: BacklinksHeading;
  className?: string;
};

/**
 * The notes that link to something (SPEC-notes "Backlinks"): «Enlazada desde» under a note's body
 * and «Aparece en N notas» at the end of an entity's page. Each row opens the note (a daily note by
 * its long date, a knowledge note by its title). Nothing when no note links here. No hooks: a
 * Server Component.
 */
export function NoteBacklinks({
  title,
  notes,
  headingId,
  marker,
  heading = "title",
  className,
}: NoteBacklinksProps) {
  if (notes.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-3", className)}
      {...{ [`data-${marker}`]: "" }}
    >
      {heading === "label" ? (
        <SectionLabel as="h2" id={headingId} title={title} />
      ) : (
        <h2 id={headingId} className="bo-text-title">
          {title}
        </h2>
      )}
      <ul className="bo-list">
        {notes.map((note) => (
          <li
            key={note.id}
            data-linking-note={note.id}
            className="flex min-w-0 items-baseline gap-2 bg-surface px-4 py-3"
          >
            <Link
              href={note.href}
              className="bo-text-body line-clamp-2 min-w-0 flex-1 rounded-sm font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {note.name}
            </Link>
            {note.kind === "daily" ? (
              <span className="bo-text-label shrink-0 text-text-secondary">
                {COPY.linkDailyHint}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
