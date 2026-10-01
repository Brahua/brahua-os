"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { Key } from "@/design-system";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";

/**
 * Open/closed state of an in-place editor. Its pencil key (`trigger`) unmounts while editing,
 * so closing (saving or canceling) puts focus back on it explicitly (CLAUDE.md "Focus").
 */
export function useInlineEditor(trigger: React.RefObject<HTMLElement | null>) {
  const [editing, setEditing] = useState(false);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    trigger.current?.focus();
  }, [editing, trigger]);

  const open = useCallback(() => setEditing(true), []);
  const close = useCallback(() => {
    refocus.current = true;
    setEditing(false);
  }, []);
  return { editing, open, close };
}

/** First message for each field of a failed parse (the form shows one per field). */
export function fieldErrorsOf<Field extends string>(
  error: z.ZodError,
  fields: readonly Field[],
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (fields.includes(field as Field) && !errors[field as Field]) {
      errors[field as Field] = issue.message;
    }
  }
  return errors;
}

type EditorFormProps = {
  /** Accessible name of the form ("Editar nombre"). */
  label: string;
  onSubmit: () => void;
  onCancel: () => void;
  /**
   * The first error after a failed save. Read out by a polite live region: after Enter, focus
   * may already be on the invalid field, so moving it there says nothing new.
   */
  error?: string;
  /** False when there is nothing that could be saved (only "Cancelar" shows). */
  canSave?: boolean;
  /**
   * More controls after "Guardar"/"Cancelar" (e.g. "Eliminar hito"), inside the form so Esc on
   * them cancels the editor too instead of reaching the notices.
   */
  extra?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * The form of an in-place editor: its fields, then "Guardar" and "Cancelar". Enter in a text
 * field saves (the browser submits) and Esc cancels.
 */
export function EditorForm({
  label,
  onSubmit,
  onCancel,
  error,
  canSave = true,
  extra,
  children,
}: EditorFormProps) {
  return (
    <form
      noValidate
      aria-label={label}
      className="flex min-w-0 flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // The notice viewport also listens for Esc on the document: this one is the editor's.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      {children}
      <p role="status" className="sr-only">
        {error ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {canSave ? (
          <Key type="submit" variant="signal">
            {PROJECTS_COPY.save}
          </Key>
        ) : null}
        <Key variant="ghost" onClick={onCancel}>
          {PROJECTS_COPY.cancel}
        </Key>
      </div>
      {extra}
    </form>
  );
}
