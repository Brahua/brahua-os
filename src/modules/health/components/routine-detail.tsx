"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState } from "react";
import { IconKey, Key, TextField } from "@/design-system";
import type { ExerciseItem } from "../exercises-input";
import { HEALTH_COPY } from "../health-copy";
import { applyItemChange } from "../routine-items-optimistic";
import { DELETED_PARAM, HEALTH_PATH } from "../routes";
import { deleteRoutine, renameRoutine } from "../routines-actions";
import { ROUTINES_COPY as COPY } from "../routines-copy";
import { routineNameSchema, type RoutineItem, type RoutineRef } from "../routines-input";
import { RoutineItemsSection } from "./routine-items-section";
import { failureReason, useHealthSave } from "./use-health-save";

type RoutineDetailProps = {
  routine: RoutineRef;
  items: RoutineItem[];
  /** The live catalogue (the picker of «Agregar ejercicio»). */
  exercises: ExerciseItem[];
  /** Id of the `<h1>`. */
  headingId: string;
};

/**
 * A routine's page (SPEC-health "Pantallas"): its name, edited in place; its exercises with their
 * targets (routine-items-section.tsx); «Eliminar rutina» (the list on /health then offers
 * «Deshacer»). «Empezar esta rutina» comes with the sessions (E2).
 */
export function RoutineDetail({
  routine,
  items: serverItems,
  exercises,
  headingId,
}: RoutineDetailProps) {
  const router = useRouter();
  const { save, send, toaster, announce } = useHealthSave();
  const [items, applyChange] = useOptimistic(serverItems, applyItemChange);
  const [name, setName] = useOptimistic(routine.name, (_: string, next: string) => next);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameKey = useRef<HTMLButtonElement>(null);

  // The rename key unmounts while editing: focus goes back to it when the editor closes.
  const focusRename = useRef(false);
  useEffect(() => {
    if (!focusRename.current || editing) return;
    focusRename.current = false;
    renameKey.current?.focus();
  });

  function closeEditor() {
    focusRename.current = true;
    setEditing(false);
  }

  function rename(next: string) {
    closeEditor();
    if (next === name) return;
    save({
      apply: () => setName(next),
      key: `routine-rename:${routine.id}`,
      call: () => renameRoutine({ id: routine.id, name: next }),
      failure: COPY.notSaved.rename,
      onSuccess: () => announce(COPY.renamed),
    });
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    const result = await send(() => deleteRoutine({ id: routine.id }));
    if (!result.ok) {
      setDeleting(false);
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.delete} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    router.push(`${HEALTH_PATH}?${DELETED_PARAM}=${routine.id}`);
  }

  return (
    <article className="flex flex-col gap-8" data-routine={routine.id}>
      <header className="flex flex-col gap-4">
        <div className="flex min-w-0 items-start gap-2">
          <h1
            id={headingId}
            tabIndex={-1}
            className="bo-text-display min-w-0 break-words outline-none"
          >
            {name}
          </h1>
          {editing ? null : (
            <IconKey
              ref={renameKey}
              icon={Pencil}
              label={COPY.rename(name)}
              variant="ghost"
              data-routine-rename=""
              onClick={() => setEditing(true)}
            />
          )}
        </div>
        {editing ? <NameEditor name={name} onCancel={closeEditor} onSave={rename} /> : null}
        <div role="group" aria-label={COPY.actionsLabel} className="flex flex-wrap gap-2">
          {/* E2: «Empezar esta rutina» goes first here. */}
          <Key
            variant="ghost"
            icon={Trash2}
            aria-disabled={deleting || undefined}
            data-routine-delete=""
            onClick={() => void remove()}
          >
            {COPY.deleteRoutine}
          </Key>
        </div>
      </header>

      <RoutineItemsSection
        routineId={routine.id}
        items={items}
        applyChange={applyChange}
        exercises={exercises}
      />
    </article>
  );
}

/** The routine's name, edited in place. Enter saves, Esc cancels. */
function NameEditor({
  name,
  onCancel,
  onSave,
}: {
  name: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>();

  return (
    <form
      noValidate
      aria-label={COPY.renameForm}
      className="flex max-w-160 flex-col gap-3"
      data-routine-name-editor=""
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = routineNameSchema.safeParse(value);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          document.getElementById(id)?.focus();
          return;
        }
        onSave(parsed.data);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <TextField
        id={id}
        label={COPY.nameLabel}
        help={COPY.nameHelp}
        value={value}
        autoFocus
        autoComplete="off"
        error={error}
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="signal">
          {HEALTH_COPY.save}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {HEALTH_COPY.cancel}
        </Key>
      </div>
    </form>
  );
}
