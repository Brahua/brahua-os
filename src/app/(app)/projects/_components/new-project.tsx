"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Key } from "@/design-system";
import type { ProjectAreaSummary } from "@/modules/projects/project-input";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

// The sheet (form, pickers, the action's client) loads on demand: as soon as the key is pointed
// at, focused or touched, so it is usually there by the time it opens.
const loadSheet = () => import("./project-sheet");
const ProjectSheet = dynamic(() => loadSheet().then((loaded) => loaded.ProjectSheet));
const preload = () => void loadSheet();

type NewProjectProps = {
  areas: readonly ProjectAreaSummary[];
  defaultAreaId: string | null;
};

/** The "Nuevo proyecto" key and its create sheet. */
export function NewProject({ areas, defaultAreaId }: NewProjectProps) {
  const [open, setOpen] = useState(false);
  // New key per opening, so the form starts empty every time.
  const [opening, setOpening] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Key
        ref={trigger}
        variant="signal"
        icon={Plus}
        aria-haspopup="dialog"
        onPointerEnter={preload}
        onFocus={preload}
        onTouchStart={preload}
        onClick={() => {
          setOpening((value) => value + 1);
          setOpen(true);
        }}
      >
        {PROJECTS_COPY.newProject}
      </Key>
      {opening > 0 ? (
        <ProjectSheet
          key={opening}
          open={open}
          onOpenChange={setOpen}
          areas={areas}
          defaultAreaId={defaultAreaId}
          returnFocusRef={trigger}
        />
      ) : null}
    </>
  );
}
