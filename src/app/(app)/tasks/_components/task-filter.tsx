"use client";

import { ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { VIEWS_COPY } from "@/modules/tasks/views-copy";
import type { FilterOption } from "./task-filter-sheet";

// The sheet (Radix Dialog and the options) loads on demand, as soon as a key is pointed at,
// focused or touched: the list's first load stays light.
const loadSheet = () => import("./task-filter-sheet");
const TaskFilterSheet = dynamic(() => loadSheet().then((loaded) => loaded.TaskFilterSheet));
const preload = () => void loadSheet();

type TaskFilterProps = {
  /** "Área:" / "Proyecto:" before the value. */
  trigger: string;
  /** The key's accessible name for the value shown ("Filtrar por área: Hogar"). */
  triggerName: (value: string) => string;
  /** The value's name ("Hogar", or "Todas"). */
  valueName: string;
  /** How the value looks on the key (an area tag, a project name). */
  value: React.ReactNode;
  sheetTitle: string;
  listLabel: string;
  options: readonly FilterOption[];
  selectedId: string | null;
  note?: React.ReactNode;
  /** The name of each option id (for "Filtro aplicado: Hogar."). */
  nameOf: (id: string | null) => string | null;
};

/**
 * One compact filter key of "Todas" ("Área: Hogar ⌄"), whatever the number of options, like the
 * projects' area filter. It opens a sheet of links (`?area=…`, `?proyecto=…`), so the filter
 * survives a reload or a shared link. Once the page shows the picked option and the sheet is
 * gone, the result is announced.
 */
export function TaskFilter({
  trigger,
  triggerName,
  valueName,
  value,
  sheetTitle,
  listLabel,
  options,
  selectedId,
  note,
  nameOf,
}: TaskFilterProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [picked, setPicked] = useState<{ id: string | null } | null>(null);
  const [closed, setClosed] = useState(true);
  const key = useRef<HTMLButtonElement>(null);
  const announce = closed && picked !== null && picked.id === selectedId;
  const pickedName = picked ? nameOf(picked.id) : null;

  return (
    <div className="flex min-w-0">
      <Key
        ref={key}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerName(valueName)}
        className="max-w-full min-w-0"
        onPointerEnter={preload}
        onFocus={preload}
        onTouchStart={preload}
        onClick={() => {
          setPicked(null);
          setClosed(false);
          setOpened(true);
          setOpen(true);
        }}
      >
        <span className="text-text-secondary">{trigger}</span>
        {value}
        <Icon icon={ChevronDown} size="sm" className="shrink-0" />
      </Key>
      <p role="status" className="sr-only">
        {announce
          ? pickedName
            ? VIEWS_COPY.filterApplied(pickedName)
            : VIEWS_COPY.filterCleared
          : null}
      </p>
      {opened ? (
        <TaskFilterSheet
          open={open}
          onOpenChange={setOpen}
          title={sheetTitle}
          listLabel={listLabel}
          options={options}
          selectedId={selectedId}
          note={note}
          onPick={(id) => setPicked({ id })}
          onClosed={() => setClosed(true)}
          returnFocusRef={key}
        />
      ) : null}
    </div>
  );
}
