"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Key, TextField } from "@/design-system";
import type { ExpenseFilters, SortKey } from "../expense-filters";
import { NO_METHOD_KEY } from "../expense-filters";
import { SUMMARY_COPY } from "../summary-copy";
import { SelectField } from "./select-field";

export type Option = { id: string; name: string };

type PanelProps = {
  filters: ExpenseFilters;
  onChange: (next: Partial<ExpenseFilters>) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  categories: readonly Option[];
  methods: readonly Option[];
  open: boolean;
  onToggle: () => void;
  activeCount: number;
  buttonRef: React.Ref<HTMLButtonElement>;
};

/** How long the text waits after the last key before the list filters (cleared on unmount). */
const TEXT_DELAY_MS = 250;

const toggle = (list: readonly string[], key: string) =>
  list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

/**
 * The «Filtros» key and its folding panel: categories and payment methods (sets), a text search
 * and the order. The text filters 250 ms after the last key; everything else at once.
 */
export function ExpenseFiltersPanel({
  filters,
  onChange,
  sort,
  onSort,
  categories,
  methods,
  open,
  onToggle,
  activeCount,
  buttonRef,
}: PanelProps) {
  const ids = useId();
  const panelId = `${ids}-panel`;
  const [draft, setDraft] = useState(filters.text);
  // The text can also change from outside (a chip's «Quitar»): follow it while rendering.
  const [seen, setSeen] = useState(filters.text);
  if (filters.text !== seen) {
    setSeen(filters.text);
    setDraft(filters.text);
  }
  useEffect(() => {
    if (draft === filters.text) return;
    const timer = setTimeout(() => onChange({ text: draft }), TEXT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, filters.text, onChange]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Key
          ref={buttonRef}
          variant="ghost"
          icon={SlidersHorizontal}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          data-filters-button=""
        >
          {SUMMARY_COPY.filtersButton(activeCount)}
        </Key>
        <div className="min-w-44">
          <SelectField
            id={`${ids}-sort`}
            label={SUMMARY_COPY.sortLabel}
            value={sort}
            options={(Object.keys(SUMMARY_COPY.sortOptions) as SortKey[]).map((value) => ({
              value,
              label: SUMMARY_COPY.sortOptions[value],
            }))}
            onValueChange={(value) => onSort(value as SortKey)}
          />
        </div>
      </div>
      <div id={panelId} hidden={!open} className="bo-card bo-filters" data-filters-panel="">
        <TextField
          label={SUMMARY_COPY.textLabel}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
        />
        <CheckGroup
          legend={SUMMARY_COPY.categoryLegend}
          options={[...categories, { id: "none", name: SUMMARY_COPY.uncategorized }]}
          selected={filters.categories}
          onToggle={(key) => onChange({ categories: toggle(filters.categories, key) })}
        />
        <CheckGroup
          legend={SUMMARY_COPY.methodLegend}
          options={[...methods, { id: NO_METHOD_KEY, name: SUMMARY_COPY.noMethod }]}
          selected={filters.methods}
          onToggle={(key) => onChange({ methods: toggle(filters.methods, key) })}
        />
      </div>
    </div>
  );
}

function CheckGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly Option[];
  selected: readonly string[];
  onToggle: (key: string) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="bo-check-list">
        {options.map((option) => (
          <label key={option.id} className="bo-check">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />
            <span className="bo-text-body-sm">{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
