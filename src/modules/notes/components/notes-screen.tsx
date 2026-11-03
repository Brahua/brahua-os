"use client";

import { NotebookPen, Pin, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key, SegmentedControl } from "@/design-system";
import { NOTES_COPY as COPY, todayNoteLabel } from "../copy";
import { NOTES_PAGE_SIZE } from "../note-constants";
import { dailyTitle } from "../note-day";
import type { NoteArea, NoteKindFilter, NoteListItem } from "../note-input";
import { editedLabel, notesListUrl } from "../note-list";
import { dailyNotePath, notePath, NOTES_PATH } from "../routes";
import { AreaSelect, NO_AREA } from "./area-select";
import { NewNoteSheet } from "./new-note-sheet";

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
}: NotesScreenProps) {
  const router = useRouter();
  const ids = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const newKey = useRef<HTMLButtonElement>(null);
  const rows = useRef<(HTMLAnchorElement | null)[]>([]);
  const focusFrom = useRef<number | null>(null);
  const filtered = kind !== "all" || areaId !== null;

  // «Ver más» brought more rows: focus the first new one.
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || items.length <= from) return;
    focusFrom.current = null;
    rows.current[from]?.focus();
  }, [items.length]);

  function go(url: string) {
    router.replace(url, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {COPY.heading}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Key asChild variant="signal">
            <Link href={dailyNotePath(today)} data-today-note-link="">
              <Icon icon={NotebookPen} />
              {todayNoteLabel(todayHasText)}
            </Link>
          </Key>
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

      <div className="flex flex-wrap items-end gap-4">
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
          onValueChange={(value) => go(notesListUrl({ kind: value, areaId }))}
        />
        <div className="min-w-48">
          <AreaSelect
            id={`${ids}-area`}
            label={COPY.areaFilterLabel}
            emptyLabel={COPY.allAreas}
            areas={areas}
            value={areaId ?? NO_AREA}
            onValueChange={(value) =>
              go(notesListUrl({ kind, areaId: value === NO_AREA ? null : value }))
            }
          />
        </div>
      </div>

      {items.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-start gap-3" data-notes-empty="filtered">
            <p className="bo-text-body text-text-secondary">{COPY.emptyFiltered}</p>
            <Key variant="ghost" onClick={() => go(NOTES_PATH)}>
              {COPY.clearFilters}
            </Key>
          </div>
        ) : (
          <div className="bo-card max-w-160 gap-3" data-notes-empty="">
            <h2 className="bo-text-title">{COPY.emptyTitle}</h2>
            <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
            <Key asChild variant="signal" className="w-fit">
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

      {more ? (
        <Key
          variant="ghost"
          className="w-fit"
          data-notes-more=""
          onClick={() => {
            focusFrom.current = items.length;
            go(notesListUrl({ kind, areaId, shown: shown + NOTES_PAGE_SIZE }));
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
