"use client";

// The `[[` picker of the note editor (SPEC-notes "Selector `[[`"). Typing `[[` and some text opens a
// list of up to 8 results UNDER the field (not by the cursor: stable with the iPhone keyboard),
// grouped by type. The focus never leaves the `textarea`, which stays a plain text box
// (`aria-autocomplete="list"`; `aria-controls` while the list exists and `aria-activedescendant` on
// the active option): ARIA in HTML allows no other role on a `textarea`, and the list's state is
// told by the announcer («3 resultados…», «Sin coincidencias»). Arrows move, Enter or Tab choose
// (never while an IME is composing), Esc closes (and doesn't leave the editor), a tap chooses on the
// phone. The search runs 150 ms after the last key press through a read-only Server Action; an
// answer to an older text is ignored. Every timer and listener is cleared.
//
// The list scrolls itself into view when it opens (the page's `scroll-padding` keeps it clear of the
// bottom bar and toasts) and is at most 40 % of the visible viewport tall (`visualViewport`: with the
// iPhone keyboard up, what is left above it), scrolling inside. Whether it sits clear of the
// keyboard is checked by the owner on the iPhone.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { NoteLinkType } from "@/lib/markdown/note-links";
import type { NoteLinkGroup } from "../contracts";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_LINK_SEARCH_DELAY_MS } from "../note-constants";
import { findLinkQuery, insertLink, type LinkQuery } from "../note-link-search";

export type SearchLinks = (input: { q: string }) => Promise<ActionResult<NoteLinkGroup[]>>;

type Option = { type: NoteLinkType; id: string; name: string; hint: string | null };

/** What choosing a result does to the text: `link` replaces `start`–`end`; then `text`, `caret`. */
export type LinkChoice = {
  text: string;
  caret: number;
  name: string;
  link: string;
  start: number;
  end: number;
};

type Options = {
  text: string;
  /** Puts the link in the text (the autosave runs as with any key press), the cursor after it. */
  onChoose: (choice: LinkChoice) => void;
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
  const listRef = useRef<HTMLDivElement>(null);

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

  // Say what the list shows, only when that changes (how many, none, or a failure): not again on
  // each answer that brings as many results while the owner keeps typing.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (state === "closed") announced.current = null;
    if (state === "closed" || state === "loading") return;
    const message =
      state === "results"
        ? COPY.linkResults(options.length)
        : state === "empty"
          ? COPY.linkNoMatches
          : COPY.linkSearchFailed;
    if (announced.current === message) return;
    announced.current = message;
    announce(message);
  }, [state, options.length, announce]);

  // Opening: the list comes into view (under a tall field it would sit below the keyboard), at most
  // 40 % of what is visible tall. `visualViewport` shrinks when the iPhone keyboard is up.
  const isOpen = state !== "closed";
  useLayoutEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    const viewport = window.visualViewport;
    function fit() {
      if (!list) return;
      if (viewport) list.style.setProperty("--bo-link-picker-max", `${viewport.height * 0.4}px`);
      list.scrollIntoView?.({ block: "nearest" });
    }
    fit();
    viewport?.addEventListener("resize", fit);
    return () => viewport?.removeEventListener("resize", fit);
  }, [isOpen]);

  const choose = useCallback(
    (option: Option) => {
      if (!match || caret === null) return;
      const next = insertLink(text, match, caret, option);
      setCaret(next.caret);
      const link = next.text.slice(match.start, next.caret);
      onChoose({ ...next, name: option.name, link, start: match.start, end: caret });
    },
    [match, caret, text, onChoose],
  );

  const listId = `${idPrefix}-links`;
  const optionId = (index: number) => `${idPrefix}-link-${index}`;
  const hasOptions = state === "results";

  /** Handles the picker's keys; true when the key was its own (the editor must ignore it). */
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    // An IME composing (Safari reports its Enter as keyCode 229) owns the key.
    if (!open || !key || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(key);
      return true;
    }
    if (!hasOptions) return false;
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
    "aria-controls": hasOptions ? listId : undefined,
    "aria-activedescendant": hasOptions ? optionId(activeIndex) : undefined,
  };

  const list = !isOpen ? null : (
    <div ref={listRef} className="bo-note-link-picker" data-note-link-picker="">
      {hasOptions ? (
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
                  return (
                    <div
                      key={item.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === activeIndex}
                      aria-setsize={options.length}
                      aria-posinset={index + 1}
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
                          <span className="sr-only">, </span>
                          {item.hint}
                        </span>
                      ) : null}
                      <span className="sr-only">, {COPY.linkTypeNames[group.type]}</span>
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
