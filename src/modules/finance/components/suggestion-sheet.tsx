"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Key, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { registerEmailSuggestion, type RegisteredSuggestion } from "../email/actions";
import { EMAIL_COPY, sourceName } from "../email/email-copy";
import type { SuggestionItem } from "../email/input";
import { categoryOptions, methodOptions } from "../expense-form";
import type { FinanceCatalog } from "../catalog-input";
import { FINANCE_COPY } from "../finance-copy";
import { centsToInput } from "../money";
import { SelectField } from "./select-field";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  item: SuggestionItem;
  catalog: FinanceCatalog;
  /** The suggestion became an expense (the sheet then closes). */
  onRegistered: (result: RegisteredSuggestion) => void;
};

const first = (errors: FieldErrors | undefined, field: string) => errors?.[field]?.[0];

/**
 * «Registrar sugerencia»: the same fields as a new expense that matter here (amount, description,
 * category and method), starting from what the email said. The currency and the day are the
 * email's. It waits for the server and shows its refusals on the fields.
 */
export function SuggestionSheet({
  open,
  onOpenChange,
  returnFocusRef,
  item,
  catalog,
  onRegistered,
}: Props) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const [amount, setAmount] = useState(() => centsToInput(item.amountCents ?? 0));
  const [description, setDescription] = useState(item.merchant ?? "");
  const [categoryId, setCategoryId] = useState("");
  // The method its card digits point at; else the last one used (the server's default).
  const [methodId, setMethodId] = useState(item.method?.id ?? catalog.lastPaymentMethodId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amountInput = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<RegisteredSuggestion>;
      try {
        result = await registerEmailSuggestion({
          id: item.id,
          overrides: { amount, description, categoryId, paymentMethodId: methodId },
        });
      } catch {
        result = fail(FINANCE_COPY.checkConnection);
      }
      if (!result.ok) {
        const fields: Record<string, string> = {};
        for (const field of ["amount", "description", "categoryId", "paymentMethodId"]) {
          const message = first(result.fieldErrors, field);
          if (message) fields[field] = message;
        }
        setErrors(fields);
        setFormError(Object.keys(fields).length > 0 ? null : result.error);
        return;
      }
      onRegistered(result.data);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={EMAIL_COPY.sheetTitle}
      description={EMAIL_COPY.sheetDescription(sourceName(item.source))}
      returnFocusRef={returnFocusRef}
      initialFocusRef={amountInput}
      closeDisabled={pending}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onOpenChange(false);
            }}
          >
            {FINANCE_COPY.close}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
          >
            {pending ? EMAIL_COPY.saving : EMAIL_COPY.sheetSave}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-suggestion-form=""
        data-saving={pending ? "" : undefined}
      >
        {formError ? (
          <p role="alert" className="bo-field__error">
            {formError}
          </p>
        ) : null}
        <TextField
          ref={amountInput}
          id={`${ids}-amount`}
          label={FINANCE_COPY.amountLabel(item.currency ?? "PEN")}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          required
          error={errors.amount}
          className="bo-amount-field"
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField
          id={`${ids}-description`}
          label={FINANCE_COPY.descriptionLabel}
          value={description}
          autoComplete="off"
          error={errors.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <SelectField
          id={`${ids}-category`}
          label={FINANCE_COPY.categoryLabel}
          value={categoryId}
          options={categoryOptions(catalog)}
          error={errors.categoryId}
          onValueChange={setCategoryId}
        />
        <SelectField
          id={`${ids}-method`}
          label={FINANCE_COPY.methodLabel}
          value={methodId}
          options={methodOptions(catalog)}
          error={errors.paymentMethodId}
          onValueChange={setMethodId}
        />
      </form>
    </Sheet>
  );
}
