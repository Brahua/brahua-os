"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, Key, SegmentedControl, Sheet, Switch, TextArea, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import type { FinanceCatalog } from "../catalog-input";
import { categoryOptions, currencyForMethod, methodOptions } from "../expense-form";
import { PAYMENT_CYCLES, type Currency, type PaymentCycle } from "../finance-constants";
import { centsToInput } from "../money";
import { createRecurringPayment, editRecurringPayment } from "../payment-actions";
import { CYCLE_LABELS, MONTH_NAMES, PAYMENTS_COPY, WEEKDAY_NAMES } from "../payments-copy";
import {
  createRecurringInputSchema,
  RECURRING_FIELDS,
  updateRecurringInputSchema,
  type RecurringField,
  type RecurringItem,
} from "../recurring-input";
import { isoWeekday } from "../schedule";
import { SelectField } from "./select-field";

type Errors = Partial<Record<RecurringField, string>>;

function errorsOf(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of RECURRING_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const CYCLE_OPTIONS = PAYMENT_CYCLES.map((cycle) => ({ value: cycle, label: CYCLE_LABELS[cycle] }));
const WEEKDAY_OPTIONS = range(1, 7).map((day) => ({
  value: String(day),
  label: WEEKDAY_NAMES[day].charAt(0).toUpperCase() + WEEKDAY_NAMES[day].slice(1),
}));
const DAY_OPTIONS = range(1, 31).map((day) => ({ value: String(day), label: String(day) }));
const INTERVAL_OPTIONS = range(2, 12).map((n) => ({
  value: String(n),
  label: PAYMENTS_COPY.intervalOption(n),
}));
const MONTH_OPTIONS = range(1, 12).map((month) => ({
  value: String(month),
  label: MONTH_NAMES[month].charAt(0).toUpperCase() + MONTH_NAMES[month].slice(1),
}));

type RecurringSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Editing this payment; null: a new one. */
  recurring: RecurringItem | null;
  catalog: FinanceCatalog;
  /** Lima's today: a new payment's start date and the defaults of its cycle. */
  today: string;
  /** Saved (the sheet then closes); announce once it has (`onClosed`) or right away. */
  onSaved?: (item: RecurringItem) => void;
  onClosed?: () => void;
};

/**
 * "Pago recurrente" (SPEC-finance "Hojas"): name, cycle and its fields (weekday; day of the month;
 * every N months from a month; day and month of the year), the expected amount or "Monto
 * variable", currency, method, category, start date and notes. A new one starts monthly on
 * today's day, from today. It waits for the server; errors go to their field.
 */
export function RecurringSheet({
  open,
  onOpenChange,
  returnFocusRef,
  recurring,
  catalog,
  today,
  onSaved,
  onClosed,
}: RecurringSheetProps) {
  const isDesktop = useIsDesktop();
  const editing = recurring !== null;
  const ids = useId();
  const formId = `${ids}-form`;
  const todayDay = Number(today.slice(8, 10));
  const todayMonth = Number(today.slice(5, 7));

  const [name, setName] = useState(recurring?.name ?? "");
  const [cycle, setCycle] = useState<PaymentCycle>(recurring?.cycle ?? "monthly");
  const [weekday, setWeekday] = useState(String(recurring?.weekday ?? isoWeekday(today)));
  const [dayOfMonth, setDayOfMonth] = useState(String(recurring?.dayOfMonth ?? todayDay));
  const [intervalMonths, setIntervalMonths] = useState(String(recurring?.intervalMonths ?? 3));
  const [anchorMonth, setAnchorMonth] = useState(String(recurring?.anchorMonth ?? todayMonth));
  const [variable, setVariable] = useState(editing && recurring.amountCents === null);
  const [amount, setAmount] = useState(
    recurring?.amountCents != null ? centsToInput(recurring.amountCents) : "",
  );
  const [methodId, setMethodId] = useState(recurring?.paymentMethod?.id ?? "");
  // A new payment's currency follows its method until the owner picks one.
  const [currencyChoice, setCurrencyChoice] = useState<Currency | null>(
    recurring?.currency ?? null,
  );
  const currency = currencyChoice ?? currencyForMethod(catalog, methodId);
  const [categoryId, setCategoryId] = useState(recurring?.category?.id ?? "");
  const [startDate, setStartDate] = useState(recurring?.startDate ?? today);
  const [notes, setNotes] = useState(recurring?.notes ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const fields = useRef(new Map<RecurringField, HTMLElement | null>());
  const focusFirstInvalid = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = RECURRING_FIELDS.find((field) => errors[field]);
    if (first) fields.current.get(first)?.focus();
  });

  const fieldRef = (field: RecurringField) => (element: HTMLElement | null) => {
    fields.current.set(field, element);
  };

  function clear(field: RecurringField) {
    if (!errors[field]) return;
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const next = errorsOf(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(next);
    setFormError(Object.keys(next).length > 0 ? null : result.error);
    const first = RECURRING_FIELDS.map((field) => next[field]).find(Boolean);
    if (first) announce(first);
  }

  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = {
      ...(editing ? { id: recurring.id } : {}),
      name,
      variable,
      amount: variable ? "" : amount,
      currency,
      categoryId,
      paymentMethodId: methodId,
      cycle,
      weekday: Number(weekday),
      dayOfMonth: Number(dayOfMonth),
      intervalMonths: Number(intervalMonths),
      anchorMonth: Number(anchorMonth),
      startDate,
      notes,
    };
    const parsed = (editing ? updateRecurringInputSchema : createRecurringInputSchema).safeParse(
      input,
    );
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<RecurringItem>;
      try {
        result = editing ? await editRecurringPayment(input) : await createRecurringPayment(input);
      } catch {
        result = fail(PAYMENTS_COPY.checkConnection);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      onSaved?.(result.data);
      onOpenChange(false);
    });
  }

  const monthBased = cycle !== "weekly";
  const variableId = `${ids}-variable`;
  const currencyLabelId = `${ids}-currency`;

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={editing ? PAYMENTS_COPY.editTitle : PAYMENTS_COPY.newTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={nameInput}
      closeDisabled={pending}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {PAYMENTS_COPY.close}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
          >
            {pending ? PAYMENTS_COPY.saving : PAYMENTS_COPY.save}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-recurring-form=""
        data-saving={pending ? "" : undefined}
      >
        <TextField
          ref={(element) => {
            nameInput.current = element;
            fieldRef("name")(element);
          }}
          id={`${ids}-name`}
          label={PAYMENTS_COPY.nameLabel}
          value={name}
          autoComplete="off"
          required
          error={errors.name}
          help={PAYMENTS_COPY.nameHelp}
          onChange={(event) => {
            setName(event.target.value);
            clear("name");
          }}
        />

        <SelectField
          ref={fieldRef("cycle")}
          id={`${ids}-cycle`}
          label={PAYMENTS_COPY.cycleLabel}
          value={cycle}
          options={CYCLE_OPTIONS}
          error={errors.cycle}
          onValueChange={(value) => {
            setCycle(value as PaymentCycle);
            clear("cycle");
          }}
        />

        {cycle === "weekly" ? (
          <SelectField
            ref={fieldRef("weekday")}
            id={`${ids}-weekday`}
            label={PAYMENTS_COPY.weekdayLabel}
            value={weekday}
            options={WEEKDAY_OPTIONS}
            error={errors.weekday}
            onValueChange={(value) => {
              setWeekday(value);
              clear("weekday");
            }}
          />
        ) : null}
        {cycle === "every_n_months" ? (
          <SelectField
            ref={fieldRef("intervalMonths")}
            id={`${ids}-interval`}
            label={PAYMENTS_COPY.intervalLabel}
            value={intervalMonths}
            options={INTERVAL_OPTIONS}
            error={errors.intervalMonths}
            onValueChange={(value) => {
              setIntervalMonths(value);
              clear("intervalMonths");
            }}
          />
        ) : null}
        {monthBased ? (
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2">
            <SelectField
              ref={fieldRef("dayOfMonth")}
              id={`${ids}-day`}
              label={PAYMENTS_COPY.dayOfMonthLabel}
              value={dayOfMonth}
              options={DAY_OPTIONS}
              error={errors.dayOfMonth}
              help={Number(dayOfMonth) >= 29 ? PAYMENTS_COPY.dayOfMonthHelp : undefined}
              onValueChange={(value) => {
                setDayOfMonth(value);
                clear("dayOfMonth");
              }}
            />
            {cycle === "every_n_months" || cycle === "yearly" ? (
              <SelectField
                ref={fieldRef("anchorMonth")}
                id={`${ids}-month`}
                label={
                  cycle === "yearly" ? PAYMENTS_COPY.yearMonthLabel : PAYMENTS_COPY.anchorLabel
                }
                value={anchorMonth}
                options={MONTH_OPTIONS}
                error={errors.anchorMonth}
                onValueChange={(value) => {
                  setAnchorMonth(value);
                  clear("anchorMonth");
                }}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span id={variableId} className="bo-field__label">
              {PAYMENTS_COPY.variableLabel}
            </span>
            <span id={`${variableId}-help`} className="bo-field__help">
              {PAYMENTS_COPY.variableHelp}
            </span>
          </div>
          <Switch
            checked={variable}
            aria-labelledby={variableId}
            aria-describedby={`${variableId}-help`}
            onCheckedChange={(next) => {
              setVariable(next);
              clear("amount");
            }}
            data-variable-switch=""
          />
        </div>
        {variable ? null : (
          <TextField
            ref={fieldRef("amount")}
            id={`${ids}-amount`}
            label={PAYMENTS_COPY.amountFieldLabel(currency)}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            className="bo-amount-field"
            error={errors.amount}
            help={PAYMENTS_COPY.amountHelp}
            onChange={(event) => {
              setAmount(event.target.value);
              clear("amount");
            }}
          />
        )}

        <div className={cn("bo-field", errors.currency && "is-error")}>
          <span id={currencyLabelId} className="bo-field__label">
            {PAYMENTS_COPY.currencyLabel}
          </span>
          <SegmentedControl
            mode="radio"
            touch
            label={PAYMENTS_COPY.currencyLabel}
            aria-labelledby={currencyLabelId}
            options={[
              { value: "PEN", label: PAYMENTS_COPY.currencyPEN },
              { value: "USD", label: PAYMENTS_COPY.currencyUSD },
            ]}
            value={currency}
            onValueChange={(value) => {
              setCurrencyChoice(value);
              clear("currency");
            }}
          />
          {errors.currency ? (
            <span className="bo-field__error">
              <Icon icon={TriangleAlert} size="sm" />
              {errors.currency}
            </span>
          ) : null}
        </div>

        <SelectField
          ref={fieldRef("paymentMethodId")}
          id={`${ids}-method`}
          label={PAYMENTS_COPY.methodLabel}
          value={methodId}
          options={methodOptions(catalog, recurring?.paymentMethod ?? null)}
          error={errors.paymentMethodId}
          onValueChange={(value) => {
            setMethodId(value);
            clear("paymentMethodId");
          }}
        />
        <SelectField
          ref={fieldRef("categoryId")}
          id={`${ids}-category`}
          label={PAYMENTS_COPY.categoryLabel}
          value={categoryId}
          options={categoryOptions(catalog, recurring?.category ?? null)}
          error={errors.categoryId}
          onValueChange={(value) => {
            setCategoryId(value);
            clear("categoryId");
          }}
        />
        <TextField
          ref={fieldRef("startDate")}
          id={`${ids}-start`}
          type="date"
          label={PAYMENTS_COPY.startLabel}
          className="bo-date-field"
          value={startDate}
          error={errors.startDate}
          help={PAYMENTS_COPY.startHelp}
          onChange={(event) => {
            setStartDate(event.target.value);
            clear("startDate");
          }}
        />
        <TextArea
          ref={fieldRef("notes")}
          id={`${ids}-notes`}
          label={PAYMENTS_COPY.notesLabel}
          value={notes}
          rows={3}
          error={errors.notes}
          onChange={(event) => {
            setNotes(event.target.value);
            clear("notes");
          }}
        />

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        <p role="status" className="sr-only" data-recurring-status="">
          {pending ? PAYMENTS_COPY.savingStatus : announcement}
        </p>
      </form>
    </Sheet>
  );
}
