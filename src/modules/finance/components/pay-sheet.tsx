"use client";

import { EyeOff } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Key, Sheet, TextField } from "@/design-system";
import { fail, type FieldErrors } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import type { FinanceCatalog } from "../catalog-input";
import { methodOptions } from "../expense-form";
import { centsToInput } from "../money";
import { PAYMENTS_COPY, spokenDay } from "../payments-copy";
import { PAY_FIELDS, payInputSchema, type PayField, type RecurringItem } from "../recurring-input";
import { SelectField } from "./select-field";

/** What "Registrar pago" hands to the host (validated with the same schema as the server). */
export type PayOverrides = { amount: string; spentOn: string; paymentMethodId: string };

/** The period the sheet pays: a pending period of "Pagos", or a row of the home page (F4). */
export type PaySheetPeriod = {
  recurring: Pick<RecurringItem, "id" | "name" | "amountCents" | "currency" | "paymentMethod">;
  dueOn: string;
};

type PaySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The period to pay (or skip). */
  period: PaySheetPeriod;
  /**
   * The method options. Null while a host that has no catalog reads it (the home page): the
   * payment's own method is offered meanwhile, and the sheet can be saved.
   */
  catalog: FinanceCatalog | null;
  /** Lima's today: the date by default and the field's maximum. */
  today: string;
  /** Where focus goes when the sheet closes (the host points it at a neighbor after a save). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** "Registrar pago": the host closes the sheet and saves (optimistic, with "Deshacer"). */
  onPay: (overrides: PayOverrides) => void;
  /**
   * "Omitir este período": the host closes the sheet and saves. Without it the sheet has no skip
   * (the home page only pays, F4).
   */
  onSkip?: () => void;
};

/**
 * "Pagado…" (SPEC-finance "Hojas"): the amount (the expected one, or empty and focused for a
 * variable payment), the date (today) and the method (the payment's) before registering the
 * period's expense; and "Omitir este período". The host saves optimistically, so the sheet only
 * validates what it can on the client and closes.
 */
export function PaySheet({
  open,
  onOpenChange,
  period,
  catalog,
  today,
  returnFocusRef,
  onPay,
  onSkip,
}: PaySheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const { recurring, dueOn } = period;
  const [amount, setAmount] = useState(() =>
    recurring.amountCents === null ? "" : centsToInput(recurring.amountCents),
  );
  const [spentOn, setSpentOn] = useState(today);
  const [methodId, setMethodId] = useState(recurring.paymentMethod?.id ?? "");
  const [errors, setErrors] = useState<Partial<Record<PayField, string>>>({});
  const amountInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const methodSelect = useRef<HTMLSelectElement>(null);

  function showErrors(fieldErrors: FieldErrors | undefined) {
    const next: Partial<Record<PayField, string>> = {};
    for (const field of PAY_FIELDS) {
      const message = fieldErrors?.[field]?.[0];
      if (message) next[field] = message;
    }
    setErrors(next);
    const first = PAY_FIELDS.find((field) => next[field]);
    const target = { amount: amountInput, spentOn: dateInput, paymentMethodId: methodSelect };
    if (first) target[first].current?.focus();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const overrides = { amount, spentOn, paymentMethodId: methodId };
    const parsed = payInputSchema.safeParse({ id: recurring.id, dueOn, ...overrides });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed.fieldErrors);
      return;
    }
    onPay(overrides);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={PAYMENTS_COPY.paySheetTitle(recurring.name)}
      description={PAYMENTS_COPY.paySheetDescription(spokenDay(dueOn), dueOn < today)}
      returnFocusRef={returnFocusRef}
      initialFocusRef={amountInput}
      footer={
        <>
          <Key variant="ghost" className="flex-1 lg:flex-none" onClick={() => onOpenChange(false)}>
            {PAYMENTS_COPY.close}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            shortcut={isDesktop ? "↵" : undefined}
          >
            {PAYMENTS_COPY.confirmPay}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-pay-form=""
      >
        <TextField
          ref={amountInput}
          id={`${ids}-amount`}
          label={PAYMENTS_COPY.amountLabel(recurring.currency)}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          required
          className="bo-amount-field"
          error={errors.amount}
          help={recurring.amountCents === null ? PAYMENTS_COPY.variableHelp : undefined}
          onKeyDown={(event) => {
            // Enter saves even though the submit key lives in the footer (outside the form).
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => {
            setAmount(event.target.value);
            setErrors((previous) => ({ ...previous, amount: undefined }));
          }}
        />
        <TextField
          ref={dateInput}
          id={`${ids}-date`}
          type="date"
          label={PAYMENTS_COPY.dateLabel}
          className="bo-date-field"
          value={spentOn}
          max={today}
          error={errors.spentOn}
          help={PAYMENTS_COPY.dateHelp}
          onChange={(event) => {
            setSpentOn(event.target.value);
            setErrors((previous) => ({ ...previous, spentOn: undefined }));
          }}
        />
        <SelectField
          ref={methodSelect}
          id={`${ids}-method`}
          label={PAYMENTS_COPY.methodLabel}
          value={methodId}
          options={methodOptions(catalog, recurring.paymentMethod)}
          error={errors.paymentMethodId}
          onValueChange={(value) => {
            setMethodId(value);
            setErrors((previous) => ({ ...previous, paymentMethodId: undefined }));
          }}
        />
        {onSkip ? (
          <div className="flex flex-col gap-2 border-t border-border pt-5">
            <Key
              variant="ghost"
              icon={EyeOff}
              className="w-fit"
              aria-describedby={`${ids}-skip-help`}
              onClick={onSkip}
            >
              {PAYMENTS_COPY.skip}
            </Key>
            <span id={`${ids}-skip-help`} className="bo-field__help">
              {PAYMENTS_COPY.skipHelp}
            </span>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
