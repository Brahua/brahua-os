"use client";

import { Tag, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/design-system";
import { cn } from "@/lib/cn";
import { normalizeTagName, suggestTags, tagNameProblem, TASK_TAGS_MAX } from "../task-tags";
import { TAGS_COPY } from "../tags-copy";

type TagInputProps = {
  id: string;
  /** The field's label. Visually hidden with `labelHidden` (a section heading names it). */
  label: string;
  labelHidden?: boolean;
  /** The tags chosen, normalized, in order. */
  value: readonly string[];
  /** A tag was added or removed (the whole new list). */
  onValueChange: (next: string[]) => void;
  /** The tags in use, the most used first (null while loading): the suggestions. */
  known: readonly string[] | null;
  /** An error from outside (e.g. the server refused them). */
  error?: string;
};

/**
 * The tag field (T4): type a name and press Enter or a comma to add it; the existing tags are
 * suggested as you type. An editable combobox with a listbox popup and list autocomplete, without
 * automatic selection (WAI-ARIA APG "Combobox"): ↓/↑ move through the suggestions (focus stays
 * in the field, `aria-activedescendant` points at the active one), Enter adds the active one or
 * else what was typed, Esc closes the list (and only then the sheet). Each chosen tag is a chip
 * with its "Quitar" key. Leaving the field adds what was typed, so nothing written is lost.
 */
export function TagInput({
  id,
  label,
  labelHidden = false,
  value,
  onValueChange,
  known,
  error: outerError,
}: TagInputProps) {
  const ids = useId();
  const listId = `${ids}-list`;
  const helpId = `${ids}-help`;
  const errorId = `${ids}-error`;
  const optionId = (index: number) => `${ids}-option-${index}`;

  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // Tags added here that may not be in `known` yet (created a moment ago): suggested too if
  // removed again, without asking the server.
  const [created, setCreated] = useState<string[]>([]);
  // After removing a chip: the chip whose key gets focus next (null: the field).
  const focusAfterRemove = useRef<string | null | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const pool = known ? [...known, ...created.filter((name) => !known.includes(name))] : null;
  const options = pool ? suggestTags(pool, draft, value) : [];
  const expanded = open && options.length > 0;
  const optionsKey = expanded ? options.join("\n") : "";
  const error = ownError ?? outerError;
  const full = value.length >= TASK_TAGS_MAX;

  // Esc while the list is open closes the list, not the sheet around the field: Radix listens
  // for Esc on the document in the capture phase, so this listens before it, on the window, and
  // marks the event handled (Radix then leaves the dialog open).
  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.target !== input.current) return;
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [expanded]);

  // While typing, the number of suggestions is said once it settles (~300 ms after the list
  // changes), so a screen reader user knows there is something to pick with ↓.
  useEffect(() => {
    if (optionsKey === "") return;
    const count = optionsKey.split("\n").length;
    const timer = window.setTimeout(() => say(TAGS_COPY.suggestionsCount(count)), 300);
    return () => window.clearTimeout(timer);
  }, [optionsKey]);

  // Focus after a chip left (it unmounted with the key that had focus).
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (target === undefined) return;
    focusAfterRemove.current = undefined;
    const key =
      target === null
        ? null
        : root.current?.querySelector<HTMLButtonElement>(
            `[data-tag-chip="${CSS.escape(target)}"] button`,
          );
    (key ?? input.current)?.focus();
  }, [value]);

  function say(message: string) {
    // Cleared first, so the same message twice is read twice.
    setStatus("");
    window.setTimeout(() => setStatus(message), 50);
  }

  /**
   * Adds these names in order (normalized; one already chosen is skipped). Stops at the first
   * refused one (invalid, or the task is full) and shows why; what came before it is kept.
   * Returns the index of the refused one, or -1 when all went in.
   */
  function add(raw: readonly string[]): number {
    const next = [...value];
    let last: string | null = null;
    let refusal: string | null = null;
    let refusedAt = -1;
    for (const [index, text] of raw.entries()) {
      const name = normalizeTagName(text);
      if (name === "") continue;
      refusal = tagNameProblem(name);
      if (refusal) {
        refusedAt = index;
        break;
      }
      if (next.includes(name)) {
        say(TAGS_COPY.already(name));
        continue;
      }
      if (next.length >= TASK_TAGS_MAX) {
        refusal = TAGS_COPY.full;
        refusedAt = index;
        break;
      }
      next.push(name);
      last = name;
    }
    setOwnError(refusal);
    if (last !== null) {
      onValueChange(next);
      const added = next.slice(value.length);
      setCreated((previous) => [...previous, ...added.filter((name) => !previous.includes(name))]);
      if (!refusal) say(TAGS_COPY.added(last));
    }
    return refusedAt;
  }

  function remove(name: string) {
    const index = value.indexOf(name);
    onValueChange(value.filter((tag) => tag !== name));
    setOwnError(null);
    say(TAGS_COPY.removed(name));
    // Its key had focus and is gone: the next chip's key, or the field after the last one.
    focusAfterRemove.current = value[index + 1] ?? null;
  }

  function commitDraft() {
    if (draft.trim() === "") return;
    if (add([draft]) === -1) setDraft("");
  }

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (!expanded) {
          setOpen(true);
          setActive(options.length > 0 ? 0 : -1);
          return;
        }
        setActive((index) => (index + 1) % options.length);
        return;
      }
      case "ArrowUp": {
        if (!expanded) return;
        event.preventDefault();
        setActive((index) => (index <= 0 ? options.length - 1 : index - 1));
        return;
      }
      case "Enter": {
        // Never submits the form around it: Enter adds a tag here.
        event.preventDefault();
        if (expanded && active >= 0 && options[active]) {
          if (add([options[active]]) === -1) setDraft("");
          close();
          return;
        }
        commitDraft();
        close();
        return;
      }
      case ",": {
        event.preventDefault();
        commitDraft();
        close();
        return;
      }
      default:
        return;
    }
  }

  return (
    <div ref={root} className={cn("bo-field", error && "is-error")} data-tag-input="">
      <label className={cn("bo-field__label", labelHidden && "sr-only")} htmlFor={id}>
        {label}
      </label>
      {value.length > 0 ? (
        // Rows 12 px apart: each key's 44 px touch area (extensions.css) doesn't reach the next row.
        <ul className="flex flex-wrap gap-x-2 gap-y-3" aria-label={TAGS_COPY.chosenList}>
          {value.map((name) => (
            <li key={name} className="flex min-w-0 max-w-full">
              <span className="bo-tag-chip" data-tag-chip={name}>
                <Icon icon={Tag} size="xs" className="shrink-0 text-text-secondary" />
                <span className="bo-tag-chip__name" title={name}>
                  {name}
                </span>
                <button
                  type="button"
                  className="bo-tag-chip__remove"
                  aria-label={TAGS_COPY.remove(name)}
                  onClick={() => remove(name)}
                >
                  <Icon icon={X} size="xs" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        className="bo-field__control"
        value={draft}
        placeholder={TAGS_COPY.placeholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="enter"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helpId}
        onChange={(event) => {
          const text = event.target.value;
          // A comma typed on a phone keyboard (no reliable keydown) or pasted: what comes before
          // the last comma is added, the rest stays in the field.
          if (text.includes(",")) {
            const parts = text.split(",");
            const rest = parts.pop() ?? "";
            // Refused: what went in leaves the field; the refused part and the rest stay, with the
            // reason, to be fixed.
            const refusedAt = add(parts);
            setDraft(refusedAt === -1 ? rest : [...parts.slice(refusedAt), rest].join(","));
          } else {
            setDraft(text);
            if (ownError) setOwnError(null);
          }
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onClick={() => setOpen(true)}
        onBlur={(event) => {
          // Leaving the field (not to an option, which keeps focus here): what was typed is added.
          if (root.current?.contains(event.relatedTarget as Node | null)) return;
          close();
          commitDraft();
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={TAGS_COPY.suggestions}
        className="bo-list bo-tag-listbox"
        hidden={!expanded}
      >
        {expanded
          ? options.map((name, index) => (
              <li
                key={name}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={cn("bo-row bo-row--compact", index === active && "is-focus")}
                // Keeps focus in the field (a click would blur it first).
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (add([name]) === -1) setDraft("");
                  close();
                  input.current?.focus();
                }}
              >
                <Icon icon={Tag} size="xs" className="shrink-0 text-text-secondary" />
                <span className="bo-row__title truncate">{name}</span>
              </li>
            ))
          : null}
      </ul>
      {error ? (
        <span id={errorId} className="bo-field__error">
          <Icon icon={TriangleAlert} size="sm" />
          {error}
        </span>
      ) : (
        <span id={helpId} className="bo-field__help">
          {full ? TAGS_COPY.full : TAGS_COPY.help}
          {value.length > 0 && !full ? ` ${TAGS_COPY.count(value.length)}` : null}
        </span>
      )}
      <p role="status" className="sr-only" data-tag-status="">
        {status}
      </p>
    </div>
  );
}
