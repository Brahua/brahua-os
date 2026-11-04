"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Key, TextField } from "@/design-system";
import { NOTES_COPY as COPY } from "../copy";
import { SEARCH_QUERY_MAX_LENGTH, searchWords } from "../search";

type NotesSearchProps = {
  /** The search in the URL (`?q=`, "" when not searching). */
  query: string;
  /** Search this text (Enter or «Buscar»): it has at least one word of 2 or more characters. */
  onSearch: (text: string) => void;
  /** A text with no word to search (fewer than 2 letters or numbers): nothing is sent. */
  onTooShort: () => void;
  /** Back to the list (the field keeps or takes the focus). */
  onClear: () => void;
  /** The field, so the screen can focus it. */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * «Buscar en notas» (N4, SPEC-notes "Búsqueda"): a search form at the top of /notes. It searches on
 * Enter or «Buscar» (not while typing: each search is a server render, and the result is announced
 * once); a text too short is answered here, without a request. Erasing the text keeps the results
 * until Enter (an empty Enter goes back to the list); the field's own clear button and Esc (the
 * input's non-standard `search` event) and «Limpiar búsqueda» go back to the list at once, with the
 * focus in the field.
 */
export function NotesSearch({ query, onSearch, onTooShort, onClear, inputRef }: NotesSearchProps) {
  const id = useId();
  const [draft, setDraft] = useState(query);
  const [shownQuery, setShownQuery] = useState(query);
  // What this form last sent: when the URL brings it back, the field keeps what was typed since.
  const [sent, setSent] = useState<string | null>(null);
  const ownRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownRef;
  /** The query a clear is already on its way for (Enter on an empty field also fires `search`). */
  const clearing = useRef<string | null>(null);

  // The URL changed. From this form: keep the field as it is (the owner may have typed on). From
  // elsewhere (back, «Quitar filtros», a link): the field follows the URL.
  if (shownQuery !== query) {
    setShownQuery(query);
    if (query !== sent) setDraft(query);
    setSent(null);
  }

  function clear() {
    if (!query || clearing.current === query) return;
    clearing.current = query;
    setSent("");
    setDraft("");
    onClear();
    field.current?.focus();
  }

  // The native clear button and Esc empty the field and fire `search` (no React event for it).
  const latest = useRef(clear);
  useEffect(() => {
    latest.current = clear;
  });
  useEffect(() => {
    const input = field.current;
    if (!input) return;
    const onNativeSearch = () => {
      if (input.value === "") latest.current();
    };
    input.addEventListener("search", onNativeSearch);
    return () => input.removeEventListener("search", onNativeSearch);
  }, [field]);

  useEffect(() => {
    if (clearing.current !== query) clearing.current = null;
  }, [query]);

  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-2"
      data-notes-search=""
      onSubmit={(event) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text) {
          clear();
          return;
        }
        if (searchWords(text).length === 0) {
          onTooShort();
          return;
        }
        setSent(text);
        onSearch(text);
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
        onChange={(event) => setDraft(event.target.value)}
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
