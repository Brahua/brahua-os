"use client";

import { NotebookPen, Pin, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key, SegmentedControl } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { NOTES_COPY as COPY } from "../copy";
import { NOTES_PAGE_SIZE } from "../note-constants";
import { dailyTitle } from "../note-day";
import type { NoteArea, NoteKindFilter, NoteListItem } from "../note-input";
import type { NoteSearchItem } from "../search";
import { editedLabel, notesListUrl } from "../note-list";
import { dailyNotePath, notePath, NOTES_PATH } from "../routes";
import { AreaSelect, NO_AREA } from "./area-select";
import { NewNoteSheet } from "./new-note-sheet";
import { NoteSearchResults } from "./note-search-results";
import { NotesSearch } from "./notes-search";
import { TodayNoteKey } from "./today-note-key";

type NotesScreenProps = {
  items: NoteListItem[];
  /** Whether more notes match the filters («Ver más»). */
  more: boolean;
  kind: NoteKindFilter;
  /** The area filter, or null. */
  areaId: string | null;
  /** The active areas, in their order. */
  areas: NoteArea[];
  /** How many notes the URL asks for. */
  shown: number;
  /** Lima's today. */
  today: string;
  /** Whether today's note already has text («Seguir la nota de hoy»). */
  todayHasText: boolean;
  /** Id of the `<h1>`. */
  headingId: string;
  /** Single-key shortcuts on («Nota de hoy» shows `N`). */
  shortcuts?: boolean;
  /** N4: the search in the URL (`?q=`, "" when not searching). */
  query?: string;
  /**
   * N4: the search's results (they replace the list), or null when not searching. `tooShort`: the
   * text has fewer than 2 letters or numbers (nothing was searched).
   */
  search?: { items: NoteSearchItem[]; more: boolean; tooShort: boolean } | null;
};

/**
 * Notas (SPEC-notes "Lista"): «Nota de hoy» and «Nueva nota», the filters «Todas · Diario · Notas»
 * and the area (in the URL, so a reload keeps them), pinned notes first, then by last edit, 30 at a
 * time with «Ver más» (focus lands on the first new row).
 */
export function NotesScreen({
  items,
  more,
  kind,
  areaId,
  areas,
  shown,
  today,
  todayHasText,
  headingId,
  shortcuts = false,
  query = "",
  search = null,
}: NotesScreenProps) {
  const router = useRouter();
  const { announce } = useRequiredScreenServices();
  const ids = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const newKey = useRef<HTMLButtonElement>(null);
  const rows = useRef<(HTMLAnchorElement | null)[]>([]);
  const focusFrom = useRef<number | null>(null);
  const filtered = kind !== "all" || areaId !== null;
  const searching = search !== null;
  // While searching, the results take the list's place (and «Ver más» pages through them).
  const shownItems: NoteListItem[] = searching ? search.items : items;
  const shownMore = searching ? search.more : more;
  const searchInput = useRef<HTMLInputElement>(null);
  /** A text too short was submitted: its message takes the list's place until the next search. */
  const [shortHint, setShortHint] = useState(false);
  const filters = useRef<HTMLDivElement>(null);
  /** A filter changed: say what the new list holds once it arrives. */
  const announceResult = useRef(false);
  /** «Quitar filtros» was pressed (and leaves): focus goes to the kind filter. */
  const focusFilters = useRef(false);

  useEffect(() => {
    if (focusFilters.current && !filtered) {
      focusFilters.current = false;
      const checked = filters.current?.querySelector<HTMLElement>(
        '[role="radio"][aria-checked="true"]',
      );
      (checked ?? document.getElementById(headingId))?.focus();
    }
    if (!announceResult.current) return;
    announceResult.current = false;
    if (search !== null) {
      announce(
        search.tooShort
          ? COPY.searchTooShort
          : search.items.length === 0
            ? filtered
              ? COPY.searchNoResultsFiltered(query)
              : COPY.searchNoResults(query)
            : COPY.searchResultCount(search.items.length, search.more),
      );
      return;
    }
    announce(
      items.length === 0
        ? filtered
          ? COPY.emptyFiltered
          : COPY.emptyTitle
        : COPY.noteCount(items.length, more),
    );
  }, [items, more, search, query, kind, areaId, filtered, announce, headingId]);

  // «Ver más» brought more rows: focus the first new one.
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || shownItems.length <= from) return;
    focusFrom.current = null;
    rows.current[from]?.focus();
  }, [shownItems.length]);

  function go(url: string) {
    router.replace(url, { scroll: false });
  }

  function filter(url: string) {
    announceResult.current = true;
    go(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {COPY.heading}
        </h1>
        <div className="flex flex-wrap gap-2">
          <TodayNoteKey
            day={today}
            hasText={todayHasText}
            shortcuts={shortcuts}
            variant="signal"
            className=""
          />
          <Key
            ref={newKey}
            variant="default"
            icon={Plus}
            data-new-note=""
            onClick={() => {
              setSheetKey((value) => value + 1);
              setSheetOpen(true);
            }}
          >
            {COPY.newNote}
          </Key>
        </div>
      </header>

      <NotesSearch
        query={query}
        inputRef={searchInput}
        onSearch={(text) => {
          setShortHint(false);
          filter(notesListUrl({ kind, areaId, q: text }));
        }}
        onTooShort={() => {
          // Answered here, without a request: the same message, announced.
          setShortHint(true);
          announce(COPY.searchTooShort);
        }}
        onClear={() => {
          setShortHint(false);
          filter(notesListUrl({ kind, areaId }));
        }}
      />

      <div ref={filters} className="flex flex-wrap items-end gap-4">
        <SegmentedControl
          mode="radio"
          label={COPY.kindFilterLabel}
          touch
          value={kind}
          options={[
            { value: "all", label: COPY.kindAll },
            { value: "daily", label: COPY.kindDaily },
            { value: "page", label: COPY.kindPage },
          ]}
          onValueChange={(value) => filter(notesListUrl({ kind: value, areaId, q: query }))}
        />
        <div className="min-w-48">
          <AreaSelect
            id={`${ids}-area`}
            label={COPY.areaFilterLabel}
            emptyLabel={COPY.allAreas}
            areas={areas}
            value={areaId ?? NO_AREA}
            onValueChange={(value) =>
              filter(notesListUrl({ kind, areaId: value === NO_AREA ? null : value, q: query }))
            }
          />
        </div>
      </div>

      {shortHint ? (
        <p className="bo-text-body text-text-secondary" data-notes-search-empty="short">
          {COPY.searchTooShort}
        </p>
      ) : searching ? (
        <NoteSearchResults
          query={query}
          items={search.items}
          tooShort={search.tooShort}
          filtered={filtered}
          today={today}
          rowRef={(index, element) => {
            rows.current[index] = element;
          }}
          onClearFilters={() => {
            focusFilters.current = true;
            filter(notesListUrl({ kind: "all", areaId: null, q: query }));
          }}
        />
      ) : items.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-start gap-3" data-notes-empty="filtered">
            <p className="bo-text-body text-text-secondary">{COPY.emptyFiltered}</p>
            <Key
              variant="ghost"
              onClick={() => {
                focusFilters.current = true;
                filter(NOTES_PATH);
              }}
            >
              {COPY.clearFilters}
            </Key>
          </div>
        ) : (
          <div className="bo-card max-w-160 gap-3" data-notes-empty="">
            <h2 className="bo-text-title">{COPY.emptyTitle}</h2>
            <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
            {/* The header's «Nota de hoy» is the primary key: this one is plain. */}
            <Key asChild variant="default" className="w-fit">
              <Link href={dailyNotePath(today)}>
                <Icon icon={NotebookPen} />
                {COPY.todayNote}
              </Link>
            </Key>
          </div>
        )
      ) : (
        <ul aria-label={COPY.listLabel} className="flex flex-col gap-2" data-notes-list="">
          {items.map((item, index) => {
            const name =
              item.kind === "daily" && item.day ? dailyTitle(item.day, today) : item.title;
            return (
              <li key={item.id}>
                <Link
                  ref={(element) => {
                    rows.current[index] = element;
                  }}
                  href={notePath(item.kind === "daily" && item.day ? item.day : item.id)}
                  className="bo-card flex min-w-0 flex-col gap-1 no-underline hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  data-note-row={item.id}
                >
                  <span className="bo-text-body-strong truncate">{name}</span>
                  <span className="bo-text-body-sm truncate text-text-secondary">
                    {item.excerpt || COPY.noText}
                  </span>
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
      )}

      {shownMore && !shortHint ? (
        <Key
          variant="ghost"
          className="w-fit"
          data-notes-more=""
          onClick={() => {
            focusFrom.current = shownItems.length;
            go(notesListUrl({ kind, areaId, shown: shown + NOTES_PAGE_SIZE, q: query }));
          }}
        >
          {COPY.showMore}
        </Key>
      ) : null}

      {sheetKey > 0 ? (
        <NewNoteSheet
          key={sheetKey}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          areas={areas}
          returnFocusRef={newKey}
        />
      ) : null}
    </div>
  );
}
