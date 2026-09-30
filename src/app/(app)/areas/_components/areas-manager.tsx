"use client";

import { LayoutGrid, Pencil, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { AreaTag, Icon, Key, ListRow } from "@/design-system";
import { AREAS_COPY } from "@/modules/core/areas-copy";
import type { LifeAreaSummary } from "@/modules/core/life-areas";
import { AreaSheet } from "./area-sheet";

type Editor = {
  /** New key per opening, so the form starts from the area (or empty) every time. */
  key: number;
  area: LifeAreaSummary | null;
};

/**
 * The areas list with its "Nueva área" action and the create/edit sheet. The list comes from the
 * server; after saving, the action revalidates /areas and the new list arrives with its result.
 */
export function AreasManager({ areas }: { areas: LifeAreaSummary[] }) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);

  function openEditor(area: LifeAreaSummary | null, opener: HTMLElement | null) {
    returnFocus.current = opener;
    setEditor((current) => ({ key: (current?.key ?? 0) + 1, area }));
    setOpen(true);
  }

  function announce(message: string) {
    // Cleared first so saving the same thing twice is announced twice.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-8 md:px-6 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="bo-text-display">{AREAS_COPY.title}</h1>
          <p className="bo-text-label text-text-secondary">{AREAS_COPY.count(areas.length)}</p>
        </div>
        <Key
          variant="signal"
          icon={Plus}
          aria-haspopup="dialog"
          onClick={(event) => openEditor(null, event.currentTarget)}
        >
          {AREAS_COPY.newArea}
        </Key>
      </header>

      {areas.length > 0 ? (
        <ul aria-label={AREAS_COPY.listLabel} className="bo-list max-w-160">
          {areas.map((area) => (
            <li key={area.id} className="flex">
              <ListRow
                title={
                  <AreaTag
                    area={area.color}
                    icon={area.icon}
                    label={area.name}
                    variant="large"
                    className="max-w-full [&>span:last-child]:truncate"
                  />
                }
                trailing={<Icon icon={Pencil} size="sm" />}
                aria-label={AREAS_COPY.editRow(area.name)}
                aria-haspopup="dialog"
                onClick={(event) => openEditor(area, event.currentTarget)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="bo-card max-w-160 items-start">
          <Icon icon={LayoutGrid} size="xl" className="text-text-secondary" />
          <h2 className="bo-text-title">{AREAS_COPY.emptyTitle}</h2>
          <p className="bo-text-body-sm text-text-secondary">{AREAS_COPY.emptyText}</p>
        </div>
      )}

      {editor ? (
        <AreaSheet
          key={editor.key}
          open={open}
          onOpenChange={setOpen}
          area={editor.area}
          returnFocusRef={returnFocus}
          onSaved={(area, mode) => {
            setOpen(false);
            announce(
              mode === "created" ? AREAS_COPY.created(area.name) : AREAS_COPY.updated(area.name),
            );
          }}
        />
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
