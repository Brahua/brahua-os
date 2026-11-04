"use client";

import { Pin } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { NOTES_COPY as COPY } from "../copy";
import { dailyTitle } from "../note-day";
import { editedLabel } from "../note-list";
import { notePath } from "../routes";
import type { FragmentPart, NoteSearchItem } from "../search";

type NoteSearchResultsProps = {
  /** The text searched (as in the URL). */
  query: string;
  items: NoteSearchItem[];
  /** Fewer than 2 letters or numbers: nothing was searched. */
  tooShort: boolean;
  /** The kind or area filter is on (the empty message says so and offers to remove it). */
  filtered: boolean;
  /** Lima's today. */
  today: string;
  /** Each row's link, so «Ver más» can focus the first new one. */
  rowRef: (index: number, element: HTMLAnchorElement | null) => void;
  onClearFilters: () => void;
};

/** A fragment as text with `<mark>` around the words found. Never HTML from the server. */
export function SearchFragment({ parts }: { parts: FragmentPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.mark ? (
          <mark key={index} className="bo-note-search-mark">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The search's results (N4, SPEC-notes "Búsqueda"): they replace the list. A row is the title (or
 * the long date of a daily note), the body's best fragment with the words found marked, and the
 * date of the last edit. Neutral messages for a text too short and for no results.
 */
export function NoteSearchResults({
  query,
  items,
  tooShort,
  filtered,
  today,
  rowRef,
  onClearFilters,
}: NoteSearchResultsProps) {
  if (tooShort) {
    return (
      <p className="bo-text-body text-text-secondary" data-notes-search-empty="short">
        {COPY.searchTooShort}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3" data-notes-search-empty="">
        <p className="bo-text-body text-text-secondary">
          {filtered ? COPY.searchNoResultsFiltered(query) : COPY.searchNoResults(query)}
        </p>
        {filtered ? (
          <Key variant="ghost" onClick={onClearFilters}>
            {COPY.clearFilters}
          </Key>
        ) : null}
      </div>
    );
  }
  return (
    <ul aria-label={COPY.searchResultsLabel} className="flex flex-col gap-2" data-notes-results="">
      {items.map((item, index) => {
        const name = item.kind === "daily" && item.day ? dailyTitle(item.day, today) : item.title;
        return (
          <li key={item.id}>
            <Link
              ref={(element) => rowRef(index, element)}
              href={notePath(item.kind === "daily" && item.day ? item.day : item.id)}
              className="bo-card flex min-w-0 flex-col gap-1 no-underline hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-note-result={item.id}
            >
              <span className="bo-text-body-strong truncate">{name}</span>
              {item.fragment.length > 0 ? (
                <span className="bo-text-body-sm break-words text-text-secondary">
                  <SearchFragment parts={item.fragment} />
                </span>
              ) : null}
              <span className="bo-text-label flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
                {item.pinned ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={Pin} size="sm" />
                    {COPY.pinned}
                  </span>
                ) : null}
                {item.areaName ? <span>{item.areaName}</span> : null}
                <span>{editedLabel(item.editedOn, today)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
