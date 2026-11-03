"use client";

// The `[[` picker of the note editor (SPEC-notes "Selector `[[`"). Typing `[[` and some text opens a
// list of up to 8 results UNDER the field (not by the cursor: stable with the iPhone keyboard),
// grouped by type. The focus never leaves the `textarea`: it is the combobox (`aria-activedescendant`
// points at the active option). Arrows move, Enter or Tab choose, Esc closes (and doesn't leave the
// editor), a tap chooses on the phone. The search runs 150 ms after the last key press through a
// read-only Server Action; an answer to an older text is ignored. Every timer is cleared.
//
// `role="combobox"` sits on the `textarea` only while the picker is open (decisión autónoma para
// revisar con el owner): ARIA in HTML allows no role on a `textarea`, and axe (run by the E2E with
// every rule) flags it, so at rest the field is a plain text box.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { NoteLinkType } from "@/lib/markdown/note-links";
import type { NoteLinkGroup } from "../contracts";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_LINK_SEARCH_DELAY_MS } from "../note-constants";
import { findLinkQuery, insertLink, type LinkQuery } from "../note-link-search";

export type SearchLinks = (input: { q: string }) => Promise<ActionResult<NoteLinkGroup[]>>;

type Option = { type: NoteLinkType; id: string; name: string; hint: string | null };

type Options = {
  text: string;
  /** Replaces the text (the autosave runs as with any key press) and puts the cursor at `caret`. */
  onChoose: (next: { text: string; caret: number; name: string }) => void;
  search: SearchLinks | undefined;
  /** The screen's polite announcer. */
  announce: (message: string) => void;
  /** Prefix for the list's and options' ids. */
  idPrefix: string;
};

type Results = { key: string; groups: NoteLinkGroup[] } | { key: string; failed: true };

const keyOf = (query: LinkQuery) => `${query.start}:${query.query}`;

export function useLinkPicker({ text, onChoose, search, announce, idPrefix }: Options) {
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  /** The query Esc closed (typing more opens the list again). */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [active, setActive] = useState<{ key: string; index: number } | null>(null);
  const request = useRef(0);

  const match = search && focused && caret !== null ? findLinkQuery(text, caret) : null;
  const key = match ? keyOf(match) : null;
  const open = match !== null && key !== dismissed;

  // The search, 150 ms after the last change of the query. Only the newest answer counts.
  const query = open ? match.query : null;
  useEffect(() => {
    if (query === null || key === null || !search) return;
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      void search({ q: query })
        .then((result) => {
          if (id !== request.current) return;
          setResults(result.ok ? { key, groups: result.data } : { key, failed: true });
        })
        .catch(() => {
          if (id === request.current) setResults({ key, failed: true });
        });
    }, NOTE_LINK_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, key, search]);
  // An answer after unmount is ignored too.
  useEffect(() => () => void ++request.current, []);

  // While the next answer is on its way, the last results of the same `[[` stay on screen (what is
  // seen is what Enter or a tap chooses); before the first answer, «Buscando…».
  const current = open && results && results.key.startsWith(`${match.start}:`) ? results : null;
  const groups = current && "groups" in current ? current.groups : [];
  const options: Option[] = groups.flatMap((group) =>
    group.items.map((item) => ({ type: group.type, ...item })),
  );
  const state: "closed" | "loading" | "failed" | "empty" | "results" = !open
    ? "closed"
    : options.length > 0
      ? "results"
      : !current || current.key !== key
        ? "loading"
        : "failed" in current
          ? "failed"
          : "empty";
  const activeIndex =
    state === "results" && active && active.key === key
      ? Math.min(active.index, options.length - 1)
      : 0;

  // Results arrived: say how many (or that there are none, or that the search failed).
  const announced = useRef<string | null>(null);
  const answered = current?.key ?? null;
  useEffect(() => {
    if (state === "closed") announced.current = null;
    if (state === "closed" || state === "loading") return;
    const message =
      state === "results"
        ? COPY.linkResults(options.length)
        : state === "empty"
          ? COPY.linkNoMatches
          : COPY.linkSearchFailed;
    // Once per answer (not again on each key press while it stays on screen).
    const said = `${answered}|${message}`;
    if (announced.current === said) return;
    announced.current = said;
    announce(message);
  }, [state, answered, options.length, announce]);

  const choose = useCallback(
    (option: Option) => {
      if (!match || caret === null) return;
      const next = insertLink(text, match, caret, option);
      setCaret(next.caret);
      onChoose({ ...next, name: option.name });
    },
    [match, caret, text, onChoose],
  );

  const listId = `${idPrefix}-links`;
  const optionId = (index: number) => `${idPrefix}-link-${index}`;
  const expanded = state === "results";

  /** Handles the picker's keys; true when the key was its own (the editor must ignore it). */
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || !key || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(key);
      return true;
    }
    if (!expanded) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive({ key, index: (activeIndex + step + options.length) % options.length });
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      choose(options[activeIndex]);
      return true;
    }
    return false;
  }

  /** Where the cursor is, after any change, key, click or selection in the field. */
  function track(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    setCaret(field.selectionStart === field.selectionEnd ? field.selectionStart : null);
  }

  const fieldProps = {
    onSelect: track,
    onFocus: (event: React.FocusEvent<HTMLTextAreaElement>) => {
      setFocused(true);
      track(event);
    },
    onBlur: () => setFocused(false),
    "aria-autocomplete": search ? ("list" as const) : undefined,
    ...(open
      ? {
          role: "combobox",
          "aria-expanded": expanded,
          "aria-controls": listId,
          "aria-activedescendant": expanded ? optionId(activeIndex) : undefined,
        }
      : {}),
  };

  const list =
    state === "closed" ? null : (
      <div className="bo-note-link-picker" data-note-link-picker="">
        {state === "results" ? (
          <div role="listbox" id={listId} aria-label={COPY.linkPickerLabel} className="bo-list">
            {groups.map((group, groupIndex) => {
              const offset = groups
                .slice(0, groupIndex)
                .reduce((sum, previous) => sum + previous.items.length, 0);
              const labelId = `${idPrefix}-links-${group.type}`;
              return (
                <div key={group.type} role="group" aria-labelledby={labelId}>
                  <div
                    id={labelId}
                    role="presentation"
                    className="bo-text-label bg-surface px-4 pt-3 pb-1 text-text-secondary"
                  >
                    {group.label}
                  </div>
                  {group.items.map((item, itemIndex) => {
                    const index = offset + itemIndex;
                    const selected = index === activeIndex;
                    return (
                      <div
                        key={item.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        data-note-link-option={`${group.type}:${item.id}`}
                        className="bo-note-link-option flex min-h-11 min-w-0 cursor-pointer items-baseline gap-2 px-4 py-2"
                        // The focus stays in the field: a tap or click never moves it.
                        onPointerDown={(event) => event.preventDefault()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose({ type: group.type, ...item })}
                      >
                        <span className="bo-text-body min-w-0 flex-1 break-words">{item.name}</span>
                        {item.hint ? (
                          <span className="bo-text-label shrink-0 text-text-secondary">
                            {item.hint}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="bo-text-body-sm text-text-secondary" data-note-link-status="">
            {state === "loading"
              ? COPY.linkSearching
              : state === "empty"
                ? COPY.linkNoMatches
                : COPY.linkSearchFailed}
          </p>
        )}
      </div>
    );

  return { fieldProps, onKeyDown, track, list, open };
}
