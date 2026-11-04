"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useId, useRef, useState } from "react";
import { Key, SectionLabel, TextField } from "@/design-system";
import {
  EQUIPMENT_LABELS,
  EXERCISES_COPY as COPY,
  GROUP_LABELS,
  KIND_LABELS,
} from "../exercises-copy";
import type { ExerciseItem } from "../exercises-input";
import { MUSCLE_GROUPS, type MuscleGroup } from "../health-constants";
import { matchesSearch } from "../name-key";
import { exercisePath } from "../routes";
import { ExerciseFormSheet } from "./exercise-form-sheet";
import { Select } from "./exercise-fields";
import { useChangeAnnouncement } from "./use-change-announcement";
import { useHealthSave } from "./use-health-save";

type ExercisesScreenProps = {
  exercises: ExerciseItem[];
  /** Id of the page's `<h1 tabIndex={-1}>` (focus lands there after a delete). */
  headingId: string;
};

const ALL = "all";

/**
 * /health/exercises (SPEC-health "Pantallas"): the catalogue with a search (without case or
 * accents, on `name_key`) and a group filter, grouped by muscle group and ordered by name. The
 * filter runs on the client: the whole catalogue (64 to a few hundred rows) comes with the page.
 * «Nuevo ejercicio» opens the sheet; with a search that finds nothing, it starts with that name.
 */
export function ExercisesScreen({ exercises, headingId }: ExercisesScreenProps) {
  const { toaster } = useHealthSave();
  const ids = useId();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroup | typeof ALL>(ALL);
  const deferredQuery = useDeferredValue(query);
  const [sheet, setSheet] = useState<{ key: number; name: string; open: boolean }>({
    key: 0,
    name: "",
    open: false,
  });
  const opener = useRef<HTMLElement | null>(null);
  const newKey = useRef<HTMLButtonElement>(null);
  const created = useRef<ExerciseItem | null>(null);

  const shown = exercises.filter(
    (exercise) =>
      (group === ALL || exercise.muscleGroup === group) &&
      matchesSearch(exercise.nameKey, deferredQuery),
  );
  const groups = MUSCLE_GROUPS.map((value) => ({
    value,
    rows: shown.filter((exercise) => exercise.muscleGroup === value),
  })).filter(({ rows }) => rows.length > 0);
  const typed = query.trim();
  // With a search that finds nothing, «Crear «…»» helps; with only the group on, another group does.
  const emptyText = deferredQuery.trim() === "" ? COPY.noResultsInGroup : COPY.noResults;
  const announcement = useChangeAnnouncement(
    groups.length === 0 ? emptyText : COPY.results(shown.length),
  );

  function openSheet(from: HTMLElement, name: string) {
    opener.current = from;
    setSheet((current) => ({ key: current.key + 1, name, open: true }));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {COPY.pageTitle}
        </h1>
        <Key
          ref={newKey}
          variant="signal"
          icon={Plus}
          data-exercise-new=""
          onClick={(event) => openSheet(event.currentTarget, "")}
        >
          {COPY.newExercise}
        </Key>
      </header>

      <div role="search" className="grid max-w-160 gap-4 sm:grid-cols-[1fr_auto]">
        <TextField
          id={`${ids}-search`}
          type="search"
          label={COPY.searchLabel}
          help={COPY.searchHelp}
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          data-exercise-search=""
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          id={`${ids}-group`}
          label={COPY.groupFilter}
          value={group}
          options={[
            { value: ALL, label: COPY.allGroups },
            ...MUSCLE_GROUPS.map((value) => ({ value, label: GROUP_LABELS[value] })),
          ]}
          onChange={(value) => setGroup(value as MuscleGroup | typeof ALL)}
        />
      </div>
      <p className="bo-text-body-sm text-text-secondary">{COPY.results(shown.length)}</p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {groups.length === 0 ? (
        <div className="flex max-w-160 flex-col items-start gap-3" data-exercises-empty="">
          <p className="bo-text-body text-text-secondary">{emptyText}</p>
          {typed !== "" ? (
            // This key goes away with the search once it is created: focus comes back to the
            // header's «Nuevo ejercicio».
            <Key icon={Plus} onClick={() => newKey.current && openSheet(newKey.current, typed)}>
              {COPY.createNamed(typed)}
            </Key>
          ) : null}
        </div>
      ) : (
        groups.map(({ value, rows }) => (
          <section
            key={value}
            aria-labelledby={`${ids}-${value}`}
            className="flex max-w-160 flex-col gap-3"
            data-exercise-group={value}
          >
            <SectionLabel
              id={`${ids}-${value}`}
              as="h2"
              title={GROUP_LABELS[value]}
              count={String(rows.length)}
              aria-label={COPY.groupName(GROUP_LABELS[value], rows.length)}
            />
            <ul aria-label={GROUP_LABELS[value]} className="bo-list">
              {rows.map((exercise) => (
                <li key={exercise.id} className="bg-surface" data-exercise-row={exercise.id}>
                  <Link
                    href={exercisePath(exercise.id)}
                    className="flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-md px-4 py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="bo-text-body font-medium break-words">{exercise.name}</span>
                    <span className="bo-text-body-sm text-text-secondary">
                      {COPY.rowMeta(
                        EQUIPMENT_LABELS[exercise.equipment],
                        KIND_LABELS[exercise.kind],
                      )}
                      {exercise.perDumbbell ? ` · ${COPY.perDumbbell}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ExerciseFormSheet
        key={sheet.key}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        returnFocusRef={opener}
        initialName={sheet.name}
        onCreated={(exercise) => {
          created.current = exercise;
          // The new one shows in the list, whatever filter was on.
          setQuery("");
          setGroup(ALL);
        }}
        onClosed={() => {
          const exercise = created.current;
          created.current = null;
          if (exercise) {
            toaster.push({ title: COPY.createdTitle, text: COPY.created(exercise.name) });
          }
        }}
      />
    </div>
  );
}
