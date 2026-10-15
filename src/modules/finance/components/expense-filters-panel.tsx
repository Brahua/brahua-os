"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Key, TextField } from "@/design-system";
import type { ExpenseFilters, SortKey } from "../expense-filters";
import type { CurrencyFilter, ExpenseKind } from "../expense-filters";
import { NO_METHOD_KEY } from "../expense-filters";
import { centsToInput, parseAmount } from "../money";
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
  /** YYYY-MM: the days the date fields can pick. */
  month: string;
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
  month,
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
        <fieldset>
          <legend>{SUMMARY_COPY.amountLegend}</legend>
          <div className="grid grid-cols-2 gap-3">
            <AmountField
              label={SUMMARY_COPY.minLabel}
              cents={filters.minCents}
              onCommit={(minCents) => onChange({ minCents })}
            />
            <AmountField
              label={SUMMARY_COPY.maxLabel}
              cents={filters.maxCents}
              onCommit={(maxCents) => onChange({ maxCents })}
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>{SUMMARY_COPY.datesLegend}</legend>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={SUMMARY_COPY.fromLabel}
              type="date"
              min={`${month}-01`}
              max={filters.to ?? lastDay(month)}
              value={filters.from ?? ""}
              onChange={(event) => onChange({ from: event.target.value || null })}
            />
            <TextField
              label={SUMMARY_COPY.toLabel}
              type="date"
              min={filters.from ?? `${month}-01`}
              max={lastDay(month)}
              value={filters.to ?? ""}
              onChange={(event) => onChange({ to: event.target.value || null })}
            />
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            id={`${ids}-kind`}
            label={SUMMARY_COPY.kindLabel}
            value={filters.kind}
            options={(Object.keys(SUMMARY_COPY.kindOptions) as ExpenseKind[]).map((value) => ({
              value,
              label: SUMMARY_COPY.kindOptions[value],
            }))}
            onValueChange={(value) => onChange({ kind: value as ExpenseKind })}
          />
          <SelectField
            id={`${ids}-currency`}
            label={SUMMARY_COPY.currencyLabel}
            value={filters.currency}
            options={(Object.keys(SUMMARY_COPY.currencyOptions) as CurrencyFilter[]).map(
              (value) => ({ value, label: SUMMARY_COPY.currencyOptions[value] }),
            )}
            onValueChange={(value) => onChange({ currency: value as CurrencyFilter })}
          />
        </div>
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

/** The last day of `month` (YYYY-MM) as YYYY-MM-DD. */
function lastDay(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * A bound of the range of amount, typed in soles. It commits 250 ms after the last key when it is a
 * valid amount (or empty: no bound); until then it keeps what was typed and says what is wrong.
 */
function AmountField({
  label,
  cents,
  onCommit,
}: {
  label: string;
  cents: number | null;
  onCommit: (cents: number | null) => void;
}) {
  const [draft, setDraft] = useState(cents === null ? "" : centsToInput(cents));
  // A chip's «Quitar» changes the value from outside: follow it while rendering.
  const [seen, setSeen] = useState(cents);
  if (cents !== seen) {
    setSeen(cents);
    setDraft(cents === null ? "" : centsToInput(cents));
  }
  const parsed = draft.trim() === "" ? null : parseAmount(draft);
  const value = parsed?.ok ? parsed.value : null;
  const invalid = parsed !== null && !parsed.ok;
  useEffect(() => {
    if (invalid || value === cents) return;
    const timer = setTimeout(() => onCommit(value), TEXT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [invalid, value, cents, onCommit]);
  return (
    <TextField
      label={label}
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      error={invalid ? SUMMARY_COPY.amountError : undefined}
      autoComplete="off"
    />
  );
}
