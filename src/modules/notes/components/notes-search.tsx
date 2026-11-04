"use client";

import { Search, X } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";
import { Key, TextField } from "@/design-system";
import { NOTES_COPY as COPY } from "../copy";
import { SEARCH_QUERY_MAX_LENGTH } from "../search";

type NotesSearchProps = {
  /** The search in the URL (`?q=`, "" when not searching). */
  query: string;
  /** Search this text (Enter or «Buscar»). An empty text goes back to the list. */
  onSearch: (text: string) => void;
  /** Back to the list (the field keeps or takes the focus). */
  onClear: () => void;
  /** The field, so the screen can focus it. */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * «Buscar en notas» (N4, SPEC-notes "Búsqueda"): a search form at the top of /notes. It searches on
 * Enter or «Buscar» (not while typing: each search is a server render, and the result is announced
 * once). Emptying the field (its clear button, Esc in some browsers) or «Limpiar búsqueda» go back
 * to the list with the focus in the field.
 */
export function NotesSearch({ query, onSearch, onClear, inputRef }: NotesSearchProps) {
  const id = useId();
  const [draft, setDraft] = useState(query);
  const [shownQuery, setShownQuery] = useState(query);
  const ownRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownRef;

  // The URL changed (a search, back to the list, the browser's back): the field follows it.
  if (shownQuery !== query) {
    setShownQuery(query);
    setDraft(query);
  }

  function clear() {
    setDraft("");
    onClear();
    field.current?.focus();
  }

  return (
    <form
      role="search"
      aria-label={COPY.searchLabel}
      className="flex flex-wrap items-end gap-2"
      data-notes-search=""
      onSubmit={(event) => {
        event.preventDefault();
        const text = draft.trim();
        if (text) onSearch(text);
        else if (query) clear();
      }}
    >
      <TextField
        ref={field}
        id={`${id}-q`}
        label={COPY.searchLabel}
        type="search"
        name="q"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        className="min-w-0 flex-1 basis-60"
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          // The field was emptied (its clear button or Esc) while results were shown.
          if (value === "" && query) onClear();
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="default" icon={Search}>
          {COPY.searchSubmit}
        </Key>
        {query ? (
          <Key type="button" variant="ghost" icon={X} onClick={clear} data-notes-search-clear="">
            {COPY.searchClear}
          </Key>
        ) : null}
      </div>
    </form>
  );
}
