"use client";

import { ChevronDown, LayoutGrid } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { AreaTag, Icon, Key } from "@/design-system";
import type { AreaFilterOption } from "@/modules/projects/project-list";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

// The sheet (Radix Dialog and the options) loads on demand, as soon as the trigger is pointed
// at, focused or touched: the list's first load stays light.
const loadSheet = () => import("./area-filter-sheet");
const AreaFilterSheet = dynamic(() => loadSheet().then((loaded) => loaded.AreaFilterSheet));
const preload = () => void loadSheet();

type AreaFilterProps = {
  options: readonly AreaFilterOption[];
  /** Id of the area in the URL (`?area=<slug>`), or null for "Todas". */
  selectedId: string | null;
};

/**
 * Area filter of the projects list: one compact "Área: …" key, whatever the number of areas.
 * It opens a sheet (bottom on the phone, side panel on desktop) whose options are links that
 * set `?area=<slug>`, so the filter survives a reload or a shared link.
 */
export function AreaFilter({ options, selectedId }: AreaFilterProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  // What was picked in the sheet, and whether the sheet is gone: the result is announced once
  // both the page shows that area and the page is no longer hidden behind the sheet.
  const [picked, setPicked] = useState<{ id: string | null } | null>(null);
  const [closed, setClosed] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const label = selected?.name ?? PROJECTS_COPY.allAreas;
  const announce = closed && picked !== null && picked.id === selectedId;

  return (
    <div className="flex min-w-0">
      <Key
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={PROJECTS_COPY.filterTriggerName(label)}
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
        <span className="text-text-secondary">{PROJECTS_COPY.filterTrigger}</span>
        {selected ? (
          <AreaTag
            area={selected.color}
            icon={selected.icon}
            label={selected.name}
            variant="large"
            title={selected.name}
            className="min-w-0 [&>span:last-child]:truncate"
          />
        ) : (
          <span className="bo-area-tag bo-area-tag--lg">
            <Icon icon={LayoutGrid} />
            <span>{PROJECTS_COPY.allAreas}</span>
          </span>
        )}
        <Icon icon={ChevronDown} size="sm" className="shrink-0" />
      </Key>
      <p role="status" className="sr-only">
        {announce ? PROJECTS_COPY.filterApplied(selected?.name ?? null) : null}
      </p>
      {opened ? (
        <AreaFilterSheet
          open={open}
          onOpenChange={setOpen}
          options={options}
          selectedId={selectedId}
          onPick={(id) => setPicked({ id })}
          onClosed={() => setClosed(true)}
          returnFocusRef={trigger}
        />
      ) : null}
    </div>
  );
}
