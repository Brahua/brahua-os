"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Pencil,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, IconKey, Key, SegmentedControl, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { moveId } from "@/modules/core/life-area-order";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import {
  archiveCategory,
  archivePaymentMethod,
  createCategory,
  createPaymentMethod,
  renameCategory,
  reorderCategories,
  reorderPaymentMethods,
  setExchangeRate,
  unarchiveCategory,
  unarchivePaymentMethod,
  updatePaymentMethod,
} from "../catalog-actions";
import {
  createCategoryInputSchema,
  createPaymentMethodInputSchema,
  setExchangeRateInputSchema,
  type CatalogKind,
  type CategoryItem,
  type FinanceCatalog,
} from "../catalog-input";
import type { Currency } from "../finance-constants";
import { FINANCE_COPY } from "../finance-copy";
import { formatRate, rateToInput } from "../money";
import { useFinanceScreen, useRegisterSettings } from "./finance-screen";

type Result = ActionResult<FinanceCatalog>;

/** The first message of a failed result: a field's own when it gives one, else the general. */
function reasonOf(result: { error: string; fieldErrors?: Record<string, string[]> }): string {
  return (
    Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0] ?? result.error
  );
}

/** Calls an action; a network failure (or a new deployment) reads like a refusal. */
async function call(action: (input: unknown) => Promise<Result>, input: unknown): Promise<Result> {
  try {
    return await action(input);
  } catch {
    return fail(FINANCE_COPY.checkConnection);
  }
}

/**
 * "Ajustes" of /finance (SPEC-finance "Pantallas"): a key in the header that opens the sheet with
 * the USD → PEN rate, the categories and the payment methods.
 */
export function FinanceSettings() {
  const { catalog } = useFinanceScreen();
  const register = useRegisterSettings();
  const [open, setOpen] = useState(false);
  // A new sheet per opening (it starts from the page's catalog).
  const [opening, setOpening] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  // Where focus returns: this key, or what opened the sheet from elsewhere (F3's "Fijar tipo de
  // cambio" in the month's header).
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    register((returnTo) => {
      returnFocus.current = returnTo ?? trigger.current;
      setOpening((value) => value + 1);
      setOpen(true);
    });
    return () => register(null);
  }, [register]);

  return (
    <>
      <Key
        ref={trigger}
        variant="ghost"
        icon={Settings2}
        aria-haspopup="dialog"
        onClick={() => {
          returnFocus.current = trigger.current;
          setOpening((value) => value + 1);
          setOpen(true);
        }}
      >
        {FINANCE_COPY.settings}
      </Key>
      {opening > 0 ? (
        <SettingsSheet
          key={opening}
          open={open}
          onOpenChange={(next) => {
            // Setting the rate removes "Fijar tipo de cambio" behind the sheet: focus then
            // returns to this key.
            if (!next && !returnFocus.current?.isConnected) returnFocus.current = trigger.current;
            setOpen(next);
          }}
          returnFocusRef={returnFocus}
          initialCatalog={catalog}
        />
      ) : null}
    </>
  );
}

type SettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  initialCatalog: FinanceCatalog;
};

/**
 * The sheet: every change waits for the server (a few hundred ms) and then shows the catalog it
 * answers with, so the sheet never shows something that isn't stored. Messages are read inside
 * the sheet (the page under it is hidden from screen readers while it is open).
 */
export function SettingsSheet({
  open,
  onOpenChange,
  returnFocusRef,
  initialCatalog,
}: SettingsSheetProps) {
  const isDesktop = useIsDesktop();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState<string | null>(null);
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();
  // Which action is saving ("create:categories", "rate"…): only its key says so.
  const [busyTag, setBusyTag] = useState<string | null>(null);

  /**
   * Runs a catalog action: on success the sheet takes the catalog it returns, says `done` and
   * calls `after` (focus); on failure `onError` gets the field's message (or the sheet shows it).
   */
  function run(
    action: (input: unknown) => Promise<Result>,
    input: unknown,
    {
      tag,
      done,
      after,
      onError,
    }: {
      tag: string;
      done: (catalog: FinanceCatalog) => string;
      after?: (catalog: FinanceCatalog) => void;
      onError?: (message: string) => boolean;
    },
  ) {
    if (pending) return;
    setError(null);
    setBusyTag(tag);
    startTransition(async () => {
      const result = await call(action, input);
      setBusyTag(null);
      if (!result.ok) {
        const message = reasonOf(result);
        // On its field (not live): said through the status region. Otherwise the alert says it.
        if (onError?.(message)) announce(message);
        else setError(message);
        return;
      }
      setCatalog(result.data);
      announce(done(result.data));
      after?.(result.data);
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
      title={FINANCE_COPY.settingsTitle}
      description={FINANCE_COPY.settingsDescription}
      returnFocusRef={returnFocusRef}
      focusTitleOnOpen
      closeDisabled={pending}
      onEscapeKeyDown={(event) => {
        // Esc inside an inline edit cancels the edit (focus back to its "Editar"), not the sheet.
        const form = (document.activeElement as HTMLElement | null)?.closest("[data-inline-edit]");
        if (!form) return;
        event.preventDefault();
        form.querySelector<HTMLButtonElement>("[data-cancel-edit]")?.click();
      }}
    >
      <div
        className="flex flex-col gap-8"
        data-finance-settings=""
        data-saving={pending ? "" : undefined}
      >
        {error ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {error}
          </p>
        ) : null}
        <RateSection catalog={catalog} pending={pending} busyTag={busyTag} run={run} />
        <CatalogSection
          kind="categories"
          items={catalog.categories}
          archived={catalog.archivedCategories}
          pending={pending}
          busyTag={busyTag}
          run={run}
        />
        <CatalogSection
          kind="methods"
          items={catalog.methods}
          archived={catalog.archivedMethods}
          pending={pending}
          busyTag={busyTag}
          run={run}
        />
        <p role="status" className="sr-only" data-settings-status="">
          {announcement}
        </p>
      </div>
    </Sheet>
  );
}

type Run = (
  action: (input: unknown) => Promise<Result>,
  input: unknown,
  options: {
    tag: string;
    done: (catalog: FinanceCatalog) => string;
    after?: (catalog: FinanceCatalog) => void;
    onError?: (message: string) => boolean;
  },
) => void;

function RateSection({
  catalog,
  pending,
  busyTag,
  run,
}: {
  catalog: FinanceCatalog;
  pending: boolean;
  busyTag: string | null;
  run: Run;
}) {
  const ids = useId();
  const [value, setValue] = useState(() =>
    catalog.usdToPenE4 === null ? "" : rateToInput(catalog.usdToPenE4),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = setExchangeRateInputSchema.safeParse({ rate: value });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? null);
      input.current?.focus();
      return;
    }
    run(
      setExchangeRate,
      { rate: value },
      {
        tag: "rate",
        done: (next) =>
          next.usdToPenE4 === null
            ? FINANCE_COPY.rateCleared
            : FINANCE_COPY.rateSaved(formatRate(next.usdToPenE4)),
        after: (next) => setValue(next.usdToPenE4 === null ? "" : rateToInput(next.usdToPenE4)),
        onError: (message) => {
          setFieldError(message);
          input.current?.focus();
          return true;
        },
      },
    );
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h3 id={`${ids}-title`} className="bo-text-body font-semibold">
        {FINANCE_COPY.rateHeading}
      </h3>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3" data-rate-form="">
        <TextField
          ref={input}
          id={`${ids}-rate`}
          label={FINANCE_COPY.rateLabel}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          className="bo-amount-field"
          error={fieldError ?? undefined}
          help={catalog.usdToPenE4 === null ? FINANCE_COPY.rateNotSet : FINANCE_COPY.rateHelp}
          onChange={(event) => {
            setValue(event.target.value);
            setFieldError(null);
          }}
        />
        <Key type="submit" className="w-fit" aria-disabled={pending || undefined}>
          {busyTag === "rate" ? FINANCE_COPY.saving : FINANCE_COPY.rateSave}
        </Key>
      </form>
    </section>
  );
}

const ACTIONS = {
  categories: {
    title: FINANCE_COPY.categoriesHeading,
    empty: FINANCE_COPY.categoriesEmpty,
    newLabel: FINANCE_COPY.newCategory,
    archivedTitle: FINANCE_COPY.archivedCategories,
    archivedList: "«Archivadas»",
    reorder: reorderCategories,
    archive: archiveCategory,
    unarchive: unarchiveCategory,
  },
  methods: {
    title: FINANCE_COPY.methodsHeading,
    empty: FINANCE_COPY.methodsEmpty,
    newLabel: FINANCE_COPY.newMethod,
    archivedTitle: FINANCE_COPY.archivedMethods,
    archivedList: "«Archivados»",
    reorder: reorderPaymentMethods,
    archive: archivePaymentMethod,
    unarchive: unarchivePaymentMethod,
  },
} as const;

/** A category, or a method with its currency. */
type Item = CategoryItem & { currency?: Currency };

const currencyOf = (item: Item): Currency | null => item.currency ?? null;

function CurrencyPicker({
  value,
  onValueChange,
  labelId,
}: {
  value: Currency;
  onValueChange: (value: Currency) => void;
  labelId: string;
}) {
  return (
    <SegmentedControl
      mode="radio"
      touch
      label={FINANCE_COPY.defaultCurrency}
      aria-labelledby={labelId}
      options={[
        { value: "PEN", label: FINANCE_COPY.currencyPEN },
        { value: "USD", label: FINANCE_COPY.currencyUSD },
      ]}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

function CatalogSection({
  kind,
  items,
  archived,
  pending,
  busyTag,
  run,
}: {
  kind: CatalogKind;
  items: readonly Item[];
  archived: readonly Item[];
  pending: boolean;
  busyTag: string | null;
  run: Run;
}) {
  const copy = ACTIONS[kind];
  const ids = useId();
  const withCurrency = kind === "methods";
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState<Currency>("PEN");
  const [newError, setNewError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; currency: Currency } | null>(
    null,
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const newInput = useRef<HTMLInputElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  // Each row's keys, to keep or move focus after a change.
  const keys = useRef(new Map<string, HTMLButtonElement>());
  const setKey = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) keys.current.set(key, element);
    else keys.current.delete(key);
  };
  const focusLater = (target: () => HTMLElement | null | undefined) =>
    window.setTimeout(() => target()?.focus(), 0);

  function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = withCurrency ? { name: newName, currency: newCurrency } : { name: newName };
    const parsed = (
      withCurrency ? createPaymentMethodInputSchema : createCategoryInputSchema
    ).safeParse(input);
    if (!parsed.success) {
      setNewError(parsed.error.issues[0]?.message ?? null);
      newInput.current?.focus();
      return;
    }
    run(withCurrency ? createPaymentMethod : createCategory, input, {
      tag: `create:${kind}`,
      done: () => FINANCE_COPY.created(parsed.data.name),
      after: () => {
        setNewName("");
        setNewCurrency("PEN");
        newInput.current?.focus();
      },
      onError: (message) => {
        setNewError(message);
        newInput.current?.focus();
        return true;
      },
    });
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !editing) return;
    const { id } = editing;
    const input = withCurrency
      ? { id, name: editing.name, currency: editing.currency }
      : { id, name: editing.name };
    const parsed = createCategoryInputSchema.safeParse({ name: editing.name });
    if (!parsed.success) {
      setEditError(parsed.error.issues[0]?.message ?? null);
      editInput.current?.focus();
      return;
    }
    run(withCurrency ? updatePaymentMethod : renameCategory, input, {
      tag: `edit:${kind}`,
      done: () => FINANCE_COPY.renamed(parsed.data.name),
      after: () => {
        setEditing(null);
        setEditError(null);
        focusLater(() => keys.current.get(`edit:${id}`));
      },
      onError: (message) => {
        setEditError(message);
        editInput.current?.focus();
        return true;
      },
    });
  }

  function move(item: Item, delta: -1 | 1) {
    const from = items.findIndex((candidate) => candidate.id === item.id);
    const to = from + delta;
    if (pending || from < 0 || to < 0 || to >= items.length) return;
    const ids = moveId(
      items.map((candidate) => candidate.id),
      from,
      to,
    );
    run(
      copy.reorder,
      { ids },
      {
        tag: `move:${kind}`,
        done: () => FINANCE_COPY.moved(item.name, to + 1, items.length),
        // At an end the key it used is unavailable: keep focus on the row's other arrow.
        after: () => {
          const atEdge = delta === -1 ? to === 0 : to === items.length - 1;
          const key = atEdge ? (delta === -1 ? "down" : "up") : delta === -1 ? "up" : "down";
          focusLater(() => keys.current.get(`${key}:${item.id}`));
        },
      },
    );
  }

  function archive(item: Item) {
    if (pending) return;
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const neighbor = items[index + 1] ?? items[index - 1];
    run(
      copy.archive,
      { id: item.id },
      {
        tag: `archive:${kind}`,
        done: () => FINANCE_COPY.archived(item.name, copy.archivedList),
        after: () =>
          focusLater(() =>
            neighbor ? keys.current.get(`archive:${neighbor.id}`) : newInput.current,
          ),
      },
    );
  }

  function unarchive(item: Item) {
    if (pending) return;
    run(
      copy.unarchive,
      { id: item.id },
      {
        tag: `unarchive:${kind}`,
        done: () => FINANCE_COPY.unarchived(item.name),
        after: () => focusLater(() => keys.current.get(`edit:${item.id}`)),
      },
    );
  }

  const titleId = `${ids}-title`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-catalog={kind}>
      <h3 id={titleId} className="bo-text-body font-semibold">
        {copy.title}
      </h3>
      {items.length === 0 ? (
        <p className="bo-text-body-sm text-text-secondary">{copy.empty}</p>
      ) : (
        <ul aria-labelledby={titleId} className="flex flex-col gap-2">
          {items.map((item, index) => {
            const currency = currencyOf(item);
            if (editing?.id === item.id) {
              return (
                <li key={item.id}>
                  <form
                    noValidate
                    onSubmit={saveEdit}
                    className="bo-card gap-3"
                    data-inline-edit=""
                  >
                    <TextField
                      ref={editInput}
                      id={`${ids}-edit-${item.id}`}
                      label={FINANCE_COPY.nameLabel}
                      value={editing.name}
                      autoComplete="off"
                      error={editError ?? undefined}
                      onChange={(event) => {
                        setEditing({ ...editing, name: event.target.value });
                        setEditError(null);
                      }}
                    />
                    {withCurrency ? (
                      <div className="bo-field">
                        <span id={`${ids}-edit-currency`} className="bo-field__label">
                          {FINANCE_COPY.defaultCurrency}
                        </span>
                        <CurrencyPicker
                          labelId={`${ids}-edit-currency`}
                          value={editing.currency}
                          onValueChange={(value) => setEditing({ ...editing, currency: value })}
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Key type="submit" variant="signal" aria-disabled={pending || undefined}>
                        {busyTag === `edit:${kind}` ? FINANCE_COPY.saving : FINANCE_COPY.save}
                      </Key>
                      <Key
                        variant="ghost"
                        data-cancel-edit=""
                        aria-disabled={pending || undefined}
                        onClick={() => {
                          if (pending) return;
                          setEditing(null);
                          setEditError(null);
                          focusLater(() => keys.current.get(`edit:${item.id}`));
                        }}
                      >
                        {FINANCE_COPY.cancel}
                      </Key>
                    </div>
                  </form>
                </li>
              );
            }
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-lg px-1"
                data-catalog-item={item.name}
              >
                <span className="bo-text-body min-w-0 flex-1 break-words">
                  {item.name}
                  {currency === "USD" ? (
                    <span className="bo-text-label ml-2 text-text-secondary">USD</span>
                  ) : null}
                </span>
                <span className="flex gap-1">
                  <IconKey
                    ref={setKey(`up:${item.id}`)}
                    icon={ArrowUp}
                    variant="ghost"
                    tooltip={false}
                    label={FINANCE_COPY.moveUp(item.name)}
                    aria-disabled={pending || index === 0 || undefined}
                    onClick={() => move(item, -1)}
                  />
                  <IconKey
                    ref={setKey(`down:${item.id}`)}
                    icon={ArrowDown}
                    variant="ghost"
                    tooltip={false}
                    label={FINANCE_COPY.moveDown(item.name)}
                    aria-disabled={pending || index === items.length - 1 || undefined}
                    onClick={() => move(item, 1)}
                  />
                  <IconKey
                    ref={setKey(`edit:${item.id}`)}
                    icon={Pencil}
                    variant="ghost"
                    tooltip={false}
                    label={FINANCE_COPY.edit(item.name)}
                    aria-disabled={pending || undefined}
                    onClick={() => {
                      if (pending) return;
                      setEditError(null);
                      setEditing({ id: item.id, name: item.name, currency: currency ?? "PEN" });
                      focusLater(() => editInput.current);
                    }}
                  />
                  <IconKey
                    ref={setKey(`archive:${item.id}`)}
                    icon={Archive}
                    variant="ghost"
                    tooltip={false}
                    label={FINANCE_COPY.archive(item.name)}
                    aria-disabled={pending || undefined}
                    onClick={() => archive(item)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form noValidate onSubmit={create} className="flex flex-col gap-3" data-catalog-new={kind}>
        <TextField
          ref={newInput}
          id={`${ids}-new`}
          label={copy.newLabel}
          value={newName}
          autoComplete="off"
          error={newError ?? undefined}
          onChange={(event) => {
            setNewName(event.target.value);
            setNewError(null);
          }}
        />
        {withCurrency ? (
          <div className="bo-field">
            <span id={`${ids}-new-currency`} className="bo-field__label">
              {FINANCE_COPY.defaultCurrency}
            </span>
            <CurrencyPicker
              labelId={`${ids}-new-currency`}
              value={newCurrency}
              onValueChange={setNewCurrency}
            />
          </div>
        ) : null}
        <Key type="submit" className="w-fit" aria-disabled={pending || undefined}>
          {busyTag === `create:${kind}` ? FINANCE_COPY.adding : FINANCE_COPY.add}
        </Key>
      </form>

      {archived.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={archivedOpen}
            aria-controls={`${ids}-archived`}
            onClick={() => setArchivedOpen((value) => !value)}
            className="bo-text-body-sm flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md font-semibold text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Icon icon={ChevronDown} size="sm" className={cn(archivedOpen && "rotate-180")} />
            {copy.archivedTitle(archived.length)}
          </button>
          <ul id={`${ids}-archived`} hidden={!archivedOpen} className="flex flex-col gap-2">
            {archived.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 px-1">
                <span className="bo-text-body min-w-0 flex-1 break-words text-text-secondary">
                  {item.name}
                </span>
                <Key
                  variant="ghost"
                  icon={ArchiveRestore}
                  aria-label={FINANCE_COPY.unarchive(item.name)}
                  aria-disabled={pending || undefined}
                  onClick={() => unarchive(item)}
                >
                  {FINANCE_COPY.reactivate}
                </Key>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
