"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";

// The sheet's code loads on its first opening (like the classify and detail sheets).
const loadSheet = () => import("./postpone-sheet");
const PostponeSheet = dynamic(() => loadSheet().then((loaded) => loaded.PostponeSheet));

type Picking = {
  task: { id: string; title: string };
  minDay: string;
  initialDay: string;
  key: number;
};

type UsePostponePickerOptions = {
  /** "Mover": the day chosen. The sheet is already closing; the list moves the row. */
  onSave: (task: { id: string; title: string }, day: string) => void;
  /** After the sheet closed: if its return target left meanwhile, put focus somewhere sensible. */
  onClosed?: () => void;
};

/**
 * The "Otro día…" sheet for a list of tasks: `openFor` opens it for a task (with the days it
 * offers); render `sheet` once, anywhere in the list's tree. `returnTo` can point focus at a
 * neighbor when the row is going to leave.
 */
export function usePostponePicker({ onSave, onClosed }: UsePostponePickerOptions) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  function openFor(
    task: { id: string; title: string },
    trigger: HTMLElement,
    days: { minDay: string; initialDay: string },
  ) {
    returnFocus.current = trigger;
    setPicking((previous) => ({ task, ...days, key: (previous?.key ?? 0) + 1 }));
    setOpen(true);
  }

  const sheet = picking ? (
    <PostponeSheet
      key={picking.key}
      open={open}
      onOpenChange={setOpen}
      task={picking.task}
      minDay={picking.minDay}
      initialDay={picking.initialDay}
      returnFocusRef={returnFocus}
      onClosed={onClosed}
      onSave={(task, day) => {
        setOpen(false);
        onSave(task, day);
      }}
    />
  ) : null;

  return { openFor, sheet, returnFocus };
}
