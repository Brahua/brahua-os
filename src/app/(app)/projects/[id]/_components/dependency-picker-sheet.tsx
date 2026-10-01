"use client";

import { useId, useRef, useState } from "react";
import { Led, ListRow, Sheet, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { DependencyProject } from "@/modules/projects/dependency-input";
import { DEPENDENCIES_COPY, PROJECT_STATUS_LABELS } from "@/modules/projects/projects-copy";

export type DependencyPickerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The projects it may add (the server leaves out itself, its blockers and any cycle). */
  candidates: readonly DependencyProject[];
  /** The candidate being added (its row says "Agregando…" and the rest wait). */
  pendingId: string | null;
  /** Why the last pick was refused (a cycle made meanwhile in another tab, say). */
  error: string | undefined;
  /** The search changed: the refusal no longer describes what is shown. */
  onSearchChange: () => void;
  onPick: (candidate: DependencyProject) => void;
  /** Called once the sheet has closed and the page is no longer hidden (to announce). */
  onClosed: () => void;
  /** The "Agregar bloqueador" key, where focus goes back on close. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Moves focus to the search field (after a refusal); the section calls it. */
  searchRef: React.RefObject<HTMLInputElement | null>;
};

/** Lowercase, without accents: "cocina" finds "Cocína". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
}

/**
 * "Agregar bloqueador": a search field over the candidates, then one button per project
 * (bottom sheet on the phone, side panel on desktop). The same pattern as the list's area
 * filter: the Sheet traps focus, Esc closes it and focus goes back to the key that opened it.
 * The field filters as you type and a polite status says how many are left. With nothing to
 * pick there is no field: only why, with focus on it.
 */
export function DependencyPickerSheet({
  open,
  onOpenChange,
  candidates,
  pendingId,
  error,
  onSearchChange,
  onPick,
  onClosed,
  returnFocusRef,
  searchRef,
}: DependencyPickerSheetProps) {
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState("");
  const ids = useId();
  const listId = `${ids}-list`;
  const pending = pendingId !== null;
  const empty = candidates.length === 0;
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const needle = fold(query.trim());
  const shown = needle
    ? candidates.filter((candidate) => fold(candidate.name).includes(needle))
    : candidates;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={DEPENDENCIES_COPY.sheetTitle}
      subtitle={DEPENDENCIES_COPY.sheetSubtitle}
      returnFocusRef={returnFocusRef}
      // Nothing to pick: focus on why. On desktop, on the search; on the phone, on the title
      // (focusing the field would open the keyboard over the list).
      initialFocusRef={empty ? emptyRef : isDesktop ? searchRef : undefined}
      focusTitleOnOpen={!empty && !isDesktop}
      onClosed={() => {
        setQuery("");
        onClosed();
      }}
      closeDisabled={pending}
    >
      {empty ? (
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="bo-field__error">
              {error}
            </p>
          ) : null}
          <p
            ref={emptyRef}
            tabIndex={-1}
            className="bo-text-body-sm text-text-secondary outline-none"
          >
            {DEPENDENCIES_COPY.noCandidates}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <TextField
            ref={searchRef}
            type="search"
            label={DEPENDENCIES_COPY.searchLabel}
            value={query}
            autoComplete="off"
            enterKeyHint="search"
            aria-controls={listId}
            error={error}
            // The count while there is something to pick; with nothing, the message below says why.
            help={shown.length > 0 ? DEPENDENCIES_COPY.resultCount(shown.length) : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              onSearchChange();
            }}
          />
          <p role="status" className="sr-only">
            {needle ? DEPENDENCIES_COPY.resultCount(shown.length) : null}
          </p>
          {shown.length > 0 ? (
            <ul id={listId} className="bo-list" aria-label={DEPENDENCIES_COPY.results}>
              {shown.map((candidate) => {
                const adding = candidate.id === pendingId;
                return (
                  <li key={candidate.id} className="flex">
                    <ListRow
                      compact={isDesktop}
                      aria-disabled={pending || undefined}
                      onClick={() => {
                        if (!pending) onPick(candidate);
                      }}
                      leading={<Led area={candidate.area.color} size="sm" />}
                      title={<span className="break-words">{candidate.name}</span>}
                      subtitle={
                        adding ? (
                          DEPENDENCIES_COPY.adding
                        ) : (
                          <>
                            {/* Heard as "Hogar, Activo", not "HogarActivo". */}
                            {candidate.area.name}
                            <span aria-hidden> · </span>
                            <span className="sr-only">, </span>
                            {PROJECT_STATUS_LABELS[candidate.status]}
                          </>
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p id={listId} className="bo-text-body-sm text-text-secondary">
              {DEPENDENCIES_COPY.noMatches}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
