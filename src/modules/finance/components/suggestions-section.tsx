"use client";

import { startTransition, useId, useOptimistic, useRef, useState } from "react";
import { Key } from "@/design-system";
import {
  dismissEmailSuggestion,
  registerEmailSuggestion,
  undoDismissEmailSuggestion,
  undoRegisterEmailSuggestion,
  type RegisteredSuggestion,
} from "../email/actions";
import { EMAIL_COPY, sourceName } from "../email/email-copy";
import type { SuggestionItem } from "../email/input";
import { dayTitle } from "../finance-copy";
import { formatMoney, spokenMoney } from "../money";
import { ExpenseSheet } from "./expense-sheet";
import { useFinanceScreen } from "./finance-screen";
import { SuggestionSheet } from "./suggestion-sheet";

type SuggestionsSectionProps = { items: SuggestionItem[] };

type SheetState = { item: SuggestionItem; open: boolean };

/** What a suggestion is called in a notice: the merchant, or the email it could not read. */
const labelOf = (item: SuggestionItem) => item.merchant ?? EMAIL_COPY.unreadable;

/**
 * «Sugerencias» (SPEC-finance-email): the expenses found in the owner's bank emails, waiting for
 * a decision. «Registrar» turns one into an expense with what was read (only when Gmail verified the
 * sender), «Editar» opens it in a sheet first, «Descartar» removes it; each leaves a «Deshacer». A
 * row that leaves is optimistic and focus goes to its neighbor (or the heading).
 */
export function SuggestionsSection({ items }: SuggestionsSectionProps) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const [shown, removeShown] = useOptimistic(items, (list, id: string) =>
    list.filter((item) => item.id !== id),
  );
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [manual, setManual] = useState<SheetState | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const primaryKeys = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  // The suggestion a hand-registered expense already stands for (dismissed once, on its first save).
  const manualDone = useRef<string | null>(null);

  /** Moves focus to the neighbor of `id` (its primary key), else the heading, before the row leaves. */
  function focusNeighborOf(id: string) {
    const index = shown.findIndex((item) => item.id === id);
    const neighbor = shown[index + 1] ?? shown[index - 1];
    const target =
      (neighbor ? primaryKeys.current.get(neighbor.id) : undefined) ??
      heading.current ??
      document.querySelector<HTMLElement>("[data-finance-title]");
    returnFocus.current = target;
    target?.focus();
  }

  /** Where focus lands when the row it came from is gone: the inbox heading, else the page title. */
  function pageTitle(): HTMLElement | null {
    return heading.current ?? document.querySelector<HTMLElement>("[data-finance-title]");
  }

  function failureToast(text: string, detail?: string) {
    toaster.push({
      title: EMAIL_COPY.notSavedTitle,
      text: `${text} ${detail ?? EMAIL_COPY.checkConnection}`,
      tone: "error",
    });
  }

  function undoRegister(item: SuggestionItem, expenseId: string) {
    startTransition(async () => {
      const result = await enqueue(`email-suggestion:${item.id}`, () =>
        undoRegisterEmailSuggestion({ id: item.id, expenseId }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        announce(EMAIL_COPY.undone);
        return;
      }
      failureToast(
        EMAIL_COPY.notUndone,
        result.kind === "done" && !result.value.ok ? result.value.error : undefined,
      );
    });
  }

  function registered(item: SuggestionItem, data: RegisteredSuggestion) {
    const spoken = spokenMoney(
      data.expense.amountCents,
      data.expense.currency,
      data.expense.exchangeRateE4,
    );
    toaster.push({
      title: EMAIL_COPY.registeredTitle,
      text: EMAIL_COPY.registeredText(spoken, labelOf(item)),
      action: { label: EMAIL_COPY.undo, run: () => undoRegister(item, data.expense.id) },
    });
  }

  function registerDirect(item: SuggestionItem) {
    focusNeighborOf(item.id);
    startTransition(async () => {
      removeShown(item.id);
      const result = await enqueue(`email-suggestion:${item.id}`, () =>
        registerEmailSuggestion({ id: item.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        registered(item, result.value.data);
        return;
      }
      // Back in the list (the optimistic removal ends with the transition).
      failureToast(
        EMAIL_COPY.notRegistered,
        result.kind === "done" && !result.value.ok ? result.value.error : undefined,
      );
    });
  }

  function undoDismiss(item: SuggestionItem) {
    startTransition(async () => {
      const result = await enqueue(`email-suggestion:${item.id}`, () =>
        undoDismissEmailSuggestion({ id: item.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        announce(EMAIL_COPY.undone);
        return;
      }
      failureToast(
        EMAIL_COPY.notUndone,
        result.kind === "done" && !result.value.ok ? result.value.error : undefined,
      );
    });
  }

  function dismiss(item: SuggestionItem, { quiet = false }: { quiet?: boolean } = {}) {
    if (!quiet) focusNeighborOf(item.id);
    startTransition(async () => {
      removeShown(item.id);
      const result = await enqueue(`email-suggestion:${item.id}`, () =>
        dismissEmailSuggestion({ id: item.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        if (quiet) return;
        toaster.push({
          title: EMAIL_COPY.dismissedTitle,
          text: EMAIL_COPY.dismissedText(labelOf(item)),
          action: { label: EMAIL_COPY.undo, run: () => undoDismiss(item) },
        });
        return;
      }
      failureToast(
        EMAIL_COPY.notDismissed,
        result.kind === "done" && !result.value.ok ? result.value.error : undefined,
      );
    });
  }

  function openSheet(item: SuggestionItem, key: HTMLElement | null) {
    returnFocus.current = key;
    setSheet({ item, open: true });
  }

  function openManual(item: SuggestionItem, key: HTMLElement | null) {
    returnFocus.current = key;
    manualDone.current = null;
    setManual({ item, open: true });
  }

  return (
    <>
      {shown.length > 0 ? (
        <section
          aria-labelledby={headingId}
          className="flex flex-col gap-4"
          data-suggestions=""
          data-count={shown.length}
        >
          <div className="flex flex-col gap-1">
            <h2 ref={heading} id={headingId} tabIndex={-1} className="bo-text-title outline-none">
              {EMAIL_COPY.heading}{" "}
              <span className="bo-text-body-sm font-normal text-text-secondary">
                · {EMAIL_COPY.countLabel(shown.length)}
              </span>
            </h2>
            <p className="bo-text-body-sm text-text-secondary">{EMAIL_COPY.description}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {shown.map((item) => (
              <SuggestionRow
                key={item.id}
                item={item}
                today={today}
                registerKey={(node) => {
                  if (node) primaryKeys.current.set(item.id, node);
                  else primaryKeys.current.delete(item.id);
                }}
                onRegister={() => registerDirect(item)}
                onEdit={(key) => openSheet(item, key)}
                onManual={(key) => openManual(item, key)}
                onDismiss={() => dismiss(item)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {sheet ? (
        <SuggestionSheet
          key={sheet.item.id}
          open={sheet.open}
          onOpenChange={(open) => {
            if (!open && !returnFocus.current?.isConnected) returnFocus.current = pageTitle();
            setSheet((previous) => (previous ? { ...previous, open } : previous));
          }}
          returnFocusRef={returnFocus}
          item={sheet.item}
          catalog={catalog}
          onRegistered={(data) => {
            returnFocus.current = pageTitle();
            setSheet((previous) => (previous ? { ...previous, open: false } : previous));
            registered(sheet.item, data);
          }}
        />
      ) : null}
      {manual ? (
        <ExpenseSheet
          key={manual.item.id}
          open={manual.open}
          onOpenChange={(open) => {
            if (!open && !returnFocus.current?.isConnected) returnFocus.current = pageTitle();
            setManual((previous) => (previous ? { ...previous, open } : previous));
          }}
          returnFocusRef={returnFocus}
          catalog={catalog}
          today={today}
          onSaved={() => {
            // The expense typed by hand is what this unreadable email was: it leaves the inbox once.
            if (manualDone.current === manual.item.id) return;
            manualDone.current = manual.item.id;
            dismiss(manual.item, { quiet: true });
          }}
        />
      ) : null}
    </>
  );
}

type SuggestionRowProps = {
  item: SuggestionItem;
  today: string;
  registerKey: (node: HTMLButtonElement | null) => void;
  onRegister: () => void;
  onEdit: (key: HTMLElement | null) => void;
  onManual: (key: HTMLElement | null) => void;
  onDismiss: () => void;
};

function SuggestionRow({
  item,
  today,
  registerKey,
  onRegister,
  onEdit,
  onManual,
  onDismiss,
}: SuggestionRowProps) {
  const unreadable = item.status === "unreadable" || item.amountCents === null;
  const amount =
    item.amountCents !== null && item.currency
      ? formatMoney(item.amountCents, item.currency)
      : null;
  const meta = [
    item.occurredOn ? dayTitle(item.occurredOn, today) : null,
    sourceName(item.source),
    item.method?.name ?? (item.cardLast4 ? `·${item.cardLast4}` : null),
  ].filter(Boolean);
  const editKey = useRef<HTMLButtonElement>(null);

  return (
    <li
      className="flex flex-col gap-3 rounded-md border border-border px-4 py-3"
      data-suggestion={item.id}
      data-status={item.status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="bo-text-body min-w-0 font-semibold">
          {unreadable ? EMAIL_COPY.unreadable : item.merchant}
        </span>
        {amount ? <span className="bo-text-body font-semibold tabular-nums">{amount}</span> : null}
      </div>
      <p className="bo-text-body-sm text-text-secondary">
        {unreadable ? item.subject : meta.join(" · ")}
      </p>
      {unreadable ? (
        <p className="bo-text-body-sm text-text-secondary">{EMAIL_COPY.unreadableHelp}</p>
      ) : null}
      {item.duplicate ? (
        <p className="bo-text-body-sm text-text-secondary" data-flag="duplicate">
          <strong>{EMAIL_COPY.possibleDuplicate}.</strong> {EMAIL_COPY.possibleDuplicateHelp}
        </p>
      ) : null}
      {!item.senderVerified ? (
        <p className="bo-text-body-sm text-text-secondary" data-flag="unverified">
          <strong>{EMAIL_COPY.unverified}.</strong> {EMAIL_COPY.unverifiedHelp}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {unreadable ? (
          <Key
            ref={registerKey}
            variant="signal"
            onClick={(event) => onManual(event.currentTarget)}
          >
            {EMAIL_COPY.registerByHand}
          </Key>
        ) : item.senderVerified ? (
          <>
            <Key ref={registerKey} variant="signal" onClick={onRegister}>
              {EMAIL_COPY.register}
            </Key>
            <Key ref={editKey} variant="ghost" onClick={() => onEdit(editKey.current)}>
              {EMAIL_COPY.edit}
            </Key>
          </>
        ) : (
          // Not verified: no one-touch register, it is looked at first.
          <Key ref={registerKey} variant="signal" onClick={(event) => onEdit(event.currentTarget)}>
            {EMAIL_COPY.review}
          </Key>
        )}
        <Key variant="ghost" onClick={onDismiss}>
          {EMAIL_COPY.dismiss}
        </Key>
      </div>
    </li>
  );
}
