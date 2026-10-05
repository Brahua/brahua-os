"use client";

import { ChevronDown, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, Key, SegmentedControl, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { createExpense, deleteExpense, editExpense } from "../actions";
import type { FinanceCatalog } from "../catalog-input";
import {
  createExpenseInputSchema,
  EXPENSE_FIELDS,
  updateExpenseInputSchema,
  type ExpenseField,
  type ExpenseItem,
} from "../expense-input";
import {
  categoryOptions,
  currencyForMethod,
  defaultMethodId,
  methodOptions,
} from "../expense-form";
import type { Currency } from "../finance-constants";
import { FINANCE_COPY } from "../finance-copy";
import { centsToInput, formatMoney, formatRate, parseAmount } from "../money";
import { SelectField } from "./select-field";

type Errors = Partial<Record<ExpenseField, string>>;

/** The first message of each field the server (or the form's own Zod) refused. */
function errorsOf(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of EXPENSE_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** Fields that live under "Más": an error there opens it. */
const MORE_FIELDS: readonly ExpenseField[] = [
  "categoryId",
  "paymentMethodId",
  "currency",
  "spentOn",
];

type ExpenseSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close (the key or row that opened it). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Editing this expense; without one, a new expense. */
  expense?: ExpenseItem | null;
  /** Null while it loads (or if it failed: `catalogFailed`). */
  catalog: FinanceCatalog | null;
  catalogFailed?: boolean;
  /** Lima's today (YYYY-MM-DD): a new expense's date and the date field's maximum. */
  today: string;
  /** The quick capture's "Tarea · Gasto" switch, first in the body. */
  switcher?: React.ReactNode;
  /** An edit was saved (the sheet then closes). A new expense keeps the sheet open. */
  onSaved?: (expense: ExpenseItem) => void;
  /** "Eliminar gasto" (edit only): the host removes it (optimistic, with "Deshacer"). */
  onDelete?: (expense: ExpenseItem) => void;
  /** Once fully closed (focus back): announce here. */
  onClosed?: () => void;
};

/**
 * The expense sheet (SPEC-finance "Hojas"): "Nuevo gasto" from the quick capture and from
 * "Registrar gasto", "Editar gasto" from a row of the month.
 *
 * New: the amount has focus with the decimal keyboard; Enter saves with the defaults (today, the
 * last method, its currency, no category); "Más" shows the rest. Like the tasks capture it waits
 * for the server and then stays open, empty and focused for the next one, with "Registrado: …"
 * and its "Deshacer" inside the sheet (decisión autónoma: a notice of the shell would pile up
 * with the screen's own notices).
 *
 * Edit: every field shows; "Guardar" closes it; "Eliminar gasto" hands the expense to the host.
 */
export function ExpenseSheet({
  open,
  onOpenChange,
  returnFocusRef,
  expense = null,
  catalog,
  catalogFailed = false,
  today,
  switcher,
  onSaved,
  onDelete,
  onClosed,
}: ExpenseSheetProps) {
  const isDesktop = useIsDesktop();
  const editing = expense !== null;
  const ids = useId();
  const formId = `${ids}-form`;
  const moreId = `${ids}-more`;
  const currencyLabelId = `${ids}-currency`;

  const [amount, setAmount] = useState(() => (expense ? centsToInput(expense.amountCents) : ""));
  const [description, setDescription] = useState(() => expense?.description ?? "");
  const [categoryId, setCategoryId] = useState(() => expense?.category?.id ?? "");
  // A new expense follows the catalog's defaults until the owner picks a method or currency.
  const [methodChoice, setMethodChoice] = useState<string | null>(() =>
    expense ? (expense.paymentMethod?.id ?? "") : null,
  );
  const [currencyChoice, setCurrencyChoice] = useState<Currency | null>(() =>
    expense ? expense.currency : null,
  );
  const [spentOn, setSpentOn] = useState<string | null>(() => expense?.spentOn ?? null);
  const [moreOpen, setMoreOpen] = useState(editing);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExpenseItem | null>(null);
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [undoing, startUndo] = useTransition();
  const busy = pending || undoing;

  const methodId = methodChoice ?? defaultMethodId(catalog);
  const currency = currencyChoice ?? currencyForMethod(catalog, methodId);

  const amountInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLInputElement>(null);
  const categorySelect = useRef<HTMLSelectElement>(null);
  const methodSelect = useRef<HTMLSelectElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const focusFirstInvalid = useRef(false);
  // The latest amount, to know after an await whether the owner kept typing.
  const amountNow = useRef(amount);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = EXPENSE_FIELDS.find((field) => errors[field]);
    const fields: Record<ExpenseField, () => HTMLElement | null> = {
      amount: () => amountInput.current,
      description: () => descriptionInput.current,
      categoryId: () => categorySelect.current,
      paymentMethodId: () => methodSelect.current,
      currency: () =>
        document.querySelector<HTMLElement>(`#${CSS.escape(moreId)} [role="radio"][tabindex="0"]`),
      spentOn: () => dateInput.current,
    };
    const target = first ? fields[first]() : null;
    // After the commit: the "Más" fields may have just been shown.
    window.setTimeout(() => target?.focus(), 0);
  });

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = errorsOf(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    if (MORE_FIELDS.some((field) => fieldErrors[field])) setMoreOpen(true);
    setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
    // Enter leaves focus in the amount: the first field error is read through the status region.
    const first = EXPENSE_FIELDS.map((field) => fieldErrors[field]).find(Boolean);
    if (first) announce(first);
  }

  function clearError(field: ExpenseField) {
    if (!errors[field]) return;
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  // While saving, the sheet stays open (closing would lose the answer).
  function requestOpenChange(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
  }

  function payload() {
    const base = { amount, description, categoryId };
    if (editing) {
      return {
        ...base,
        id: expense.id,
        paymentMethodId: methodId,
        currency,
        spentOn: spentOn ?? today,
      };
    }
    // A new expense leaves out what the server can default better: a method and currency not
    // chosen before the catalog loaded, and a date not changed (today on the server's clock).
    return {
      ...base,
      ...(catalog || methodChoice !== null ? { paymentMethodId: methodId } : {}),
      ...(catalog || currencyChoice !== null ? { currency } : {}),
      ...(spentOn !== null ? { spentOn } : {}),
    };
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = payload();
    const parsed = (editing ? updateExpenseInputSchema : createExpenseInputSchema).safeParse(input);
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    const sentAmount = amount;
    startTransition(async () => {
      let result: ActionResult<ExpenseItem>;
      try {
        result = editing ? await editExpense(input) : await createExpense(input);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(FINANCE_COPY.checkConnection);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      setErrors({});
      if (editing) {
        onSaved?.(result.data);
        onOpenChange(false);
        return;
      }
      // Ready for the next one: the amount and description empty (unless the owner already typed
      // another amount), the method and currency it used stay as the new defaults.
      const item = result.data;
      if (amountNow.current === sentAmount) {
        amountNow.current = "";
        setAmount("");
      }
      setDescription("");
      setCategoryId("");
      setSaved(item);
      amountInput.current?.focus();
      announce(FINANCE_COPY.savedInSheet(savedText(item)));
      onSaved?.(item);
    });
  }

  function undoSaved() {
    const item = saved;
    if (!item || busy) return;
    startUndo(async () => {
      let result: ActionResult<ExpenseItem>;
      try {
        result = await deleteExpense({ id: item.id });
      } catch {
        result = fail(FINANCE_COPY.checkConnection);
      }
      if (!result.ok) {
        setFormError(`${FINANCE_COPY.notUndone} ${result.error}`);
        return;
      }
      setSaved(null);
      amountInput.current?.focus();
      announce(FINANCE_COPY.undoneCreate);
    });
  }

  const enterSubmits = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter saves from the fields even though the submit key lives in the sheet's footer
    // (outside the form): not left to implicit submission.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const parsedAmount = parseAmount(amount);
  const usesCurrentRate =
    !editing ||
    expense.currency !== "USD" ||
    !parsedAmount.ok ||
    parsedAmount.value !== expense.amountCents;
  const rateHelp =
    currency !== "USD"
      ? undefined
      : usesCurrentRate
        ? catalog?.usdToPenE4
          ? FINANCE_COPY.usdRate(formatRate(catalog.usdToPenE4))
          : catalog
            ? FINANCE_COPY.usdNoRate
            : undefined
        : expense.exchangeRateE4
          ? FINANCE_COPY.usdStoredRate(formatRate(expense.exchangeRateE4))
          : FINANCE_COPY.usdStoredNoRate;

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={editing ? FINANCE_COPY.editTitle : FINANCE_COPY.newExpense}
      returnFocusRef={returnFocusRef}
      initialFocusRef={amountInput}
      closeDisabled={busy}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={busy || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {FINANCE_COPY.close}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={busy || undefined}
            shortcut={isDesktop ? "↵" : undefined}
          >
            {pending ? FINANCE_COPY.saving : FINANCE_COPY.save}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-expense-form=""
        data-saving={pending ? "" : undefined}
      >
        {switcher}

        <TextField
          ref={amountInput}
          id={`${ids}-amount`}
          label={FINANCE_COPY.amountLabel}
          name="amount"
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          required
          error={errors.amount}
          help={FINANCE_COPY.amountHelp}
          className="bo-amount-field"
          onKeyDown={enterSubmits}
          onChange={(event) => {
            amountNow.current = event.target.value;
            setAmount(event.target.value);
            clearError("amount");
          }}
        />

        <TextField
          ref={descriptionInput}
          id={`${ids}-description`}
          label={FINANCE_COPY.descriptionLabel}
          name="description"
          value={description}
          autoComplete="off"
          enterKeyHint="done"
          error={errors.description}
          help={FINANCE_COPY.descriptionHelp}
          onKeyDown={enterSubmits}
          onChange={(event) => {
            setDescription(event.target.value);
            clearError("description");
          }}
        />

        {saved && !editing ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
            data-expense-saved=""
          >
            <p className="bo-text-body-sm">{FINANCE_COPY.savedInSheet(savedText(saved))}</p>
            <Key size="sm" variant="ghost" aria-disabled={busy || undefined} onClick={undoSaved}>
              {FINANCE_COPY.undo}
            </Key>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {editing ? null : (
            <button
              type="button"
              className="bo-text-body-sm flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md font-semibold text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen((value) => !value)}
            >
              <Icon icon={ChevronDown} size="sm" className={cn(moreOpen && "rotate-180")} />
              {FINANCE_COPY.more}
            </button>
          )}
          <div id={moreId} hidden={!moreOpen} className="flex flex-col gap-5">
            <SelectField
              ref={categorySelect}
              id={`${ids}-category`}
              label={FINANCE_COPY.categoryLabel}
              value={categoryId}
              options={categoryOptions(catalog, expense?.category ?? null)}
              error={errors.categoryId}
              help={catalogHelp(catalog, catalogFailed)}
              onValueChange={(value) => {
                setCategoryId(value);
                clearError("categoryId");
              }}
            />
            <SelectField
              ref={methodSelect}
              id={`${ids}-method`}
              label={FINANCE_COPY.methodLabel}
              value={methodId}
              options={methodOptions(catalog, expense?.paymentMethod ?? null)}
              error={errors.paymentMethodId}
              onValueChange={(value) => {
                // A new expense's currency follows the method until the owner picks one.
                setMethodChoice(value);
                clearError("paymentMethodId");
              }}
            />
            <div className={cn("bo-field", errors.currency && "is-error")}>
              <span id={currencyLabelId} className="bo-field__label">
                {FINANCE_COPY.currencyLabel}
              </span>
              <SegmentedControl
                mode="radio"
                touch
                label={FINANCE_COPY.currencyLabel}
                aria-labelledby={currencyLabelId}
                options={[
                  { value: "PEN", label: FINANCE_COPY.currencyPEN },
                  { value: "USD", label: FINANCE_COPY.currencyUSD },
                ]}
                value={currency}
                onValueChange={(value) => {
                  setCurrencyChoice(value);
                  clearError("currency");
                }}
              />
              {errors.currency ? (
                <span className="bo-field__error">
                  <Icon icon={TriangleAlert} size="sm" />
                  {errors.currency}
                </span>
              ) : rateHelp ? (
                <span className="bo-field__help" data-rate-help="">
                  {rateHelp}
                </span>
              ) : null}
            </div>
            <TextField
              ref={dateInput}
              id={`${ids}-date`}
              type="date"
              label={FINANCE_COPY.dateLabel}
              className="bo-date-field"
              value={spentOn ?? today}
              max={today}
              error={errors.spentOn}
              onChange={(event) => {
                setSpentOn(event.target.value);
                clearError("spentOn");
              }}
            />
          </div>
        </div>

        {editing && onDelete ? (
          <div className="flex flex-col gap-2 border-t border-border pt-5">
            <Key
              variant="ghost"
              icon={Trash2}
              className="w-fit"
              aria-describedby={`${ids}-delete-help`}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                onDelete(expense);
              }}
            >
              {FINANCE_COPY.deleteExpense}
            </Key>
            <span id={`${ids}-delete-help`} className="bo-field__help">
              {FINANCE_COPY.deleteHelp}
            </span>
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* Polite: "Guardando…" while saving, then what happened. */}
        <p role="status" className="sr-only" data-expense-status="">
          {pending ? FINANCE_COPY.savingStatus : announcement}
        </p>
      </form>
    </Sheet>
  );
}

/** "S/ 12.50 · Café" for the confirmation of a saved expense. */
function savedText(item: ExpenseItem): string {
  const what = item.description ?? item.category?.name ?? null;
  return FINANCE_COPY.savedText(formatMoney(item.amountCents, item.currency), what);
}

/** Under the category: loading, failed, or nothing. */
function catalogHelp(catalog: FinanceCatalog | null, failed: boolean): string | undefined {
  if (catalog) return undefined;
  return failed ? FINANCE_COPY.catalogLoadFailed : FINANCE_COPY.catalogLoading;
}
