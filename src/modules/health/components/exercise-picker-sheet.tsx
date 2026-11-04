"use client";

import { Plus } from "lucide-react";
import { useDeferredValue, useId, useRef, useState } from "react";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { EQUIPMENT_LABELS, EXERCISES_COPY, GROUP_LABELS } from "../exercises-copy";
import type { ExerciseItem } from "../exercises-input";
import { matchesSearch } from "../name-key";
import { ROUTINES_COPY as COPY } from "../routines-copy";
import { useChangeAnnouncement } from "./use-change-announcement";

type ExercisePickerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  exercises: readonly ExerciseItem[];
  /** One was tapped (the sheet closes itself). */
  onPick: (exercise: ExerciseItem) => void;
  /** «Nuevo ejercicio «…»»: the name typed in the search (the sheet closes itself). */
  onCreate: (name: string) => void;
  onClosed?: () => void;
};

/**
 * How many matches the picker lists at once: the whole seed (64) and a catalogue several times
 * bigger fit; the search narrows it.
 */
const MAX_SHOWN = 400;

/**
 * «Agregar ejercicio» (SPEC-health "Pantallas"): the catalogue with a search (without case or
 * accents); a tap adds it. «Nuevo ejercicio» (with what was typed) is always at the end, for an
 * exercise the catalogue doesn't have. Mount it with a new `key` on each opening.
 */
export function ExercisePickerSheet({
  open,
  onOpenChange,
  returnFocusRef,
  exercises,
  onPick,
  onCreate,
  onClosed,
}: ExercisePickerSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const matches = exercises.filter((exercise) => matchesSearch(exercise.nameKey, deferred));
  const typed = query.trim();
  const announcement = useChangeAnnouncement(
    matches.length === 0 ? COPY.pickerNone : EXERCISES_COPY.results(matches.length),
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.pickerTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={searchInput}
      onClosed={onClosed}
    >
      <div className="flex flex-col gap-4" data-exercise-picker="">
        <TextField
          ref={searchInput}
          id={`${ids}-search`}
          type="search"
          label={COPY.pickerSearch}
          help={EXERCISES_COPY.searchHelp}
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          data-picker-search=""
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="bo-text-body-sm text-text-secondary">
          {matches.length === 0 ? COPY.pickerNone : EXERCISES_COPY.results(matches.length)}
        </p>
        {/* Inside the sheet: outside it, the page is hidden from the screen reader while open. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {matches.length > 0 ? (
          <ul aria-label={COPY.pickerList} className="bo-list">
            {matches.slice(0, MAX_SHOWN).map((exercise) => (
              <li key={exercise.id} className="bg-surface">
                <button
                  type="button"
                  aria-label={COPY.pickerAdd(exercise.name)}
                  data-picker-exercise={exercise.id}
                  className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={() => {
                    onPick(exercise);
                    onOpenChange(false);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="bo-text-body font-medium break-words">{exercise.name}</span>
                    <span className="bo-text-body-sm text-text-secondary">
                      {EXERCISES_COPY.summary(
                        GROUP_LABELS[exercise.muscleGroup],
                        EQUIPMENT_LABELS[exercise.equipment],
                      )}
                    </span>
                  </span>
                  <Icon icon={Plus} size="sm" className="shrink-0 text-text-secondary" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Key
          variant="ghost"
          icon={Plus}
          className="self-start"
          data-picker-create=""
          onClick={() => {
            onCreate(typed);
            onOpenChange(false);
          }}
        >
          {typed === "" ? COPY.pickerCreateEmpty : COPY.pickerCreate(typed)}
        </Key>
      </div>
    </Sheet>
  );
}
