"use client";

import { Plus } from "lucide-react";
import { startTransition, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Key, TextField } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import {
  changeProductQuantity,
  addShoppingProduct,
  finishShoppingTrip,
  forgetShoppingProduct,
  markProductBought,
  removeProductFromShoppingList,
  undoFinishShoppingTrip,
  undoForgetProduct,
  undoRemoveProduct,
} from "../shopping-actions";
import { CATEGORY_LABELS, CATEGORY_OPTIONS, SHOPPING_COPY as COPY } from "../shopping-copy";
import type { ProductCategory } from "../shopping-constants";
import { addProductInputSchema } from "../shopping-input";
import {
  boughtProducts,
  findByName,
  groupByCategory,
  knownProducts,
  suggestionsFor,
  type ShoppingProduct,
} from "../shopping-view";

type ShoppingScreenProps = {
  /** The live products as the server read them: the list, the checked-off and the known ones. */
  products: readonly ShoppingProduct[];
};

/** What this screen changed and the server has not shown yet: a product, or `"gone"`. */
type Override = ShoppingProduct | "gone";

/** The server's message for a failed result: a field's own when it gives one, else the general. */
function reasonOf(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

const sameProduct = (a: ShoppingProduct, b: ShoppingProduct) =>
  a.id === b.id &&
  a.name === b.name &&
  a.category === b.category &&
  a.quantity === b.quantity &&
  a.status === b.status;

/**
 * The shopping list (SPEC-household "Pantallas"): an add field with suggestions of what was
 * bought before, the list by category in the order the supermarket is walked, «Comprados» with
 * «Terminé la compra», and the known products («Productos guardados»).
 *
 * - Every change is optimistic and saved in the screen's queue (src/lib/use-save-queue.ts). What
 *   this screen changed lives in `overrides` until the server shows the same thing; a refusal drops
 *   the override and says «Sin guardar». A second tap on a product still saving does nothing (a
 *   guard plus `aria-disabled`: a focused key is never `disabled`).
 * - «Deshacer» carries what the server said it did (ids, previous state), and the server writes
 *   only where nothing changed meanwhile.
 * - Focus: a key that leaves with its row hands focus to the next row's key, the one before, or
 *   the add field.
 */
export function ShoppingScreen({ products }: ShoppingScreenProps) {
  const { toaster, enqueue, announce, isCurrentDay } = useRequiredScreenServices();
  const { push } = toaster;
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const inflight = useRef(new Set<string>());
  const pendingFocus = useRef<string | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Override>>(new Map());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("otros");
  const [quantity, setQuantity] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  // The server's products changed: an override goes when it shows the same thing, or when its save
  // is over (the server is the truth then: another tab, or a value it normalized); only the ones
  // still in flight stay. Done while rendering ("adjusting state on a prop change").
  const [seenProducts, setSeenProducts] = useState(products);
  if (seenProducts !== products) {
    setSeenProducts(products);
    const next = new Map(overrides);
    for (const [id, override] of overrides) {
      const server = products.find((product) => product.id === id);
      const same =
        override === "gone" ? server === undefined : server && sameProduct(server, override);
      if (same || !saving.has(id)) next.delete(id);
    }
    if (next.size !== overrides.size) setOverrides(next);
  }

  /** The products as the owner sees them: the server's, with this screen's changes on top. */
  const view = useMemo(() => {
    const seen = new Set(products.map((product) => product.id));
    const merged: ShoppingProduct[] = [];
    for (const product of products) {
      const override = overrides.get(product.id);
      if (override === "gone") continue;
      merged.push(override ?? product);
    }
    for (const [id, override] of overrides) {
      if (override !== "gone" && !seen.has(id)) merged.push(override);
    }
    return merged;
  }, [products, overrides]);

  const groups = useMemo(() => groupByCategory(view), [view]);
  const bought = useMemo(() => boughtProducts(view), [view]);
  const known = useMemo(() => knownProducts(view), [view]);
  const suggestions = useMemo(() => suggestionsFor(view, name), [view, name]);
  const typedMatch = useMemo(() => findByName(view, name), [view, name]);

  // After a row left: focus goes where the key that was pressed has no row to be in.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = root.current?.querySelector<HTMLElement>(`[data-shopping-focus="${target}"]`);
    (element ?? nameInput.current)?.focus();
  }, [overrides]);

  function setOverride(product: ShoppingProduct, override: Override) {
    setOverrides((current) => new Map(current).set(product.id, override));
  }

  function dropOverride(id: string) {
    setOverrides((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  function notSaved(text: string, reason: string) {
    push({ title: COPY.notSavedTitle, text: `${text} ${reason}`.trim(), tone: "error" });
  }

  /**
   * The key of the row next to `id`: where focus goes when its row leaves. A product on the list
   * looks across every category (the one it leaves may have been alone in its section); the
   * checked-off and the known ones look in their own list.
   */
  function neighborFocus(id: string): string | null {
    const row = root.current?.querySelector<HTMLElement>(`[data-shopping-row="${id}"]`);
    if (!row || !root.current) return null;
    const rows = row.closest("[data-shopping-category]")
      ? [
          ...root.current.querySelectorAll<HTMLElement>(
            "[data-shopping-category] [data-shopping-row]",
          ),
        ]
      : [
          ...(row.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-shopping-row]") ??
            []),
        ];
    const at = rows.indexOf(row);
    const neighbor = rows[at + 1] ?? rows[at - 1];
    const target = neighbor?.getAttribute("data-shopping-row");
    return target ? `row:${target}` : null;
  }

  /**
   * One product's change: shown at once, saved in the queue; a refusal puts it back and says why.
   * `leaves`: the row goes away from where the key was (focus moves to its neighbor).
   */
  function change<T>({
    product,
    optimistic,
    action,
    failed,
    leaves = true,
    settle,
    onOk,
  }: {
    product: ShoppingProduct;
    optimistic: Override;
    action: () => Promise<ActionResult<T>>;
    failed: string;
    leaves?: boolean;
    /** What the server answered, as the product the screen shows from now on. */
    settle?: (data: T) => ShoppingProduct;
    onOk?: (data: T) => void;
  }): boolean {
    if (isCurrentDay && !isCurrentDay()) return false;
    if (inflight.current.has(product.id)) return false;
    inflight.current.add(product.id);
    setSaving((current) => new Set(current).add(product.id));
    if (leaves) pendingFocus.current = neighborFocus(product.id);
    setOverride(product, optimistic);
    startTransition(async () => {
      const queued = await enqueue(null, action);
      inflight.current.delete(product.id);
      setSaving((current) => {
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
      const result: ActionResult<T> =
        queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        if (leaves) pendingFocus.current = `row:${product.id}`;
        dropOverride(product.id);
        notSaved(failed, reasonOf(result));
        return;
      }
      if (settle) {
        const server = settle(result.data);
        // A different id means the server made a new row (the old one was forgotten elsewhere).
        if (server.id !== product.id) setOverride(product, "gone");
        setOverride(server, server);
      }
      onOk?.(result.data);
    });
    return true;
  }

  function toggleBought(product: ShoppingProduct) {
    const next = product.status === "bought" ? "needed" : "bought";
    change({
      product,
      optimistic: { ...product, status: next },
      action: () => markProductBought({ id: product.id, bought: next === "bought" }),
      failed: COPY.notUpdated,
      settle: (data) => data,
    });
  }

  function remove(product: ShoppingProduct) {
    change({
      product,
      optimistic: { ...product, status: "idle" },
      action: () => removeProductFromShoppingList({ id: product.id }),
      failed: COPY.notRemoved,
      settle: (data) => data.product,
      onOk: (data) =>
        push({
          title: COPY.removedTitle,
          text: COPY.removed(product.name),
          action: {
            label: COPY.undo,
            run: () => undoRemove(product, data.previousStatus, data.previousBoughtAt),
          },
        }),
    });
  }

  function undoRemove(
    product: ShoppingProduct,
    previousStatus: "needed" | "bought",
    boughtAt: string | null,
  ) {
    startTransition(async () => {
      const queued = await enqueue(null, () =>
        undoRemoveProduct({ id: product.id, previousStatus, boughtAt }),
      );
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      setOverride(result.data, result.data);
      announce(COPY.backOnList(product.name));
    });
  }

  function putOnList(product: ShoppingProduct, leaves = true) {
    change({
      product,
      optimistic: { ...product, status: "needed" },
      action: () => addShoppingProduct({ name: product.name }),
      failed: COPY.notAdded,
      leaves,
      settle: (data) => data.product,
      onOk: () => announce(COPY.added(product.name)),
    });
  }

  function forget(product: ShoppingProduct) {
    change({
      product,
      optimistic: "gone",
      action: () => forgetShoppingProduct({ id: product.id }),
      failed: COPY.notForgotten,
      onOk: () =>
        push({
          title: COPY.forgotTitle,
          text: COPY.forgot(product.name),
          action: { label: COPY.undo, run: () => undoForget(product) },
        }),
    });
  }

  function undoForget(product: ShoppingProduct) {
    startTransition(async () => {
      const queued = await enqueue(null, () => undoForgetProduct({ id: product.id }));
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      // What the server says, not the snapshot from before: it may have changed since.
      setOverride(result.data, result.data);
      announce(COPY.restored(product.name));
    });
  }

  function saveQuantity(product: ShoppingProduct, value: string): boolean {
    const next = value.trim() === "" ? null : value;
    return change({
      product,
      optimistic: { ...product, quantity: next },
      action: () => changeProductQuantity({ id: product.id, quantity: next }),
      failed: COPY.notUpdated,
      leaves: false,
      settle: (data) => data,
    });
  }

  function finish() {
    if (finishing || bought.length === 0) return;
    if (isCurrentDay && !isCurrentDay()) return;
    setFinishing(true);
    const before = bought;
    pendingFocus.current = "finish";
    for (const product of before) setOverride(product, { ...product, status: "idle" });
    startTransition(async () => {
      const queued = await enqueue(null, () => finishShoppingTrip({}));
      setFinishing(false);
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        for (const product of before) dropOverride(product.id);
        notSaved(COPY.notFinished, reasonOf(result));
        return;
      }
      const { entries } = result.data;
      push({
        title: COPY.finishedTitle,
        text: entries.length === 0 ? COPY.finishedNothing : COPY.finished(entries.length),
        ...(entries.length > 0
          ? { action: { label: COPY.undo, run: () => undoFinish(before, entries) } }
          : {}),
      });
    });
  }

  function undoFinish(
    before: readonly ShoppingProduct[],
    entries: readonly { id: string; boughtAt: string }[],
  ) {
    startTransition(async () => {
      const queued = await enqueue(null, () => undoFinishShoppingTrip({ entries }));
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      const { restored, kept } = result.data;
      for (const product of before) {
        if (restored.includes(product.id)) setOverride(product, { ...product, status: "bought" });
      }
      if (kept.length === 0) announce(COPY.undone(restored.length));
      else {
        push({
          title: COPY.finishedTitle,
          text:
            restored.length === 0
              ? COPY.notRestored(kept.length)
              : COPY.undonePartial(restored.length, kept.length),
        });
      }
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    // A name that is already known keeps its category (and quantity unless one is typed).
    const input = typedMatch
      ? { name, ...(quantity.trim() ? { quantity } : {}) }
      : { name, category, quantity };
    const parsed = addProductInputSchema.safeParse(input);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      nameInput.current?.focus();
      return;
    }
    setNameError(undefined);
    setAdding(true);
    const queued = await enqueue(null, () => addShoppingProduct(input));
    setAdding(false);
    const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
    if (!result.ok) {
      const message = reasonOf(result);
      setNameError(message);
      nameInput.current?.focus();
      return;
    }
    const { product, alreadyOnList } = result.data;
    setOverride(product, product);
    // Keep what was typed while it saved: only clear the fields that still hold what was sent.
    setName((current) => (current === input.name ? "" : current));
    setQuantity((current) => (current === quantity ? "" : current));
    announce(alreadyOnList ? COPY.alreadyOnList(product.name) : COPY.added(product.name));
    nameInput.current?.focus();
  }

  function pick(product: ShoppingProduct) {
    // A suggestion is a known product: one tap puts it on the list with what it already has. Focus
    // stays in the add field (the row the key was in is not where the owner is).
    putOnList(product, false);
    setName("");
    setQuantity("");
    nameInput.current?.focus();
  }

  const empty = groups.length === 0 && bought.length === 0;

  return (
    <div ref={root} className="flex max-w-160 flex-col gap-6" data-household-view="compras">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3" aria-label={COPY.addTitle}>
        <TextField
          ref={nameInput}
          id={`${ids}-name`}
          label={COPY.nameLabel}
          placeholder={COPY.namePlaceholder}
          autoComplete="off"
          enterKeyHint="done"
          value={name}
          error={nameError}
          help={typedMatch?.status === "needed" ? COPY.alreadyOnList(typedMatch.name) : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
        />
        {suggestions.length > 0 ? (
          <ul
            aria-label={COPY.suggestionsLabel}
            className="flex flex-wrap gap-2"
            data-shopping-suggestions=""
          >
            {suggestions.map((product) => (
              <li key={product.id}>
                <Key
                  variant="ghost"
                  aria-label={COPY.suggestionName(product.name, CATEGORY_LABELS[product.category])}
                  aria-disabled={saving.has(product.id) || undefined}
                  onClick={() => {
                    if (!saving.has(product.id)) pick(product);
                  }}
                >
                  {product.name}
                </Key>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          {typedMatch ? null : (
            <div className="bo-field min-w-40 flex-1">
              <label className="bo-field__label" htmlFor={`${ids}-category`}>
                {COPY.categoryLabel}
              </label>
              <div className="bo-select">
                <select
                  id={`${ids}-category`}
                  className="bo-field__control"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ProductCategory)}
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <TextField
            id={`${ids}-quantity`}
            label={COPY.quantityLabel}
            placeholder={COPY.quantityPlaceholder}
            autoComplete="off"
            className="w-32"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Key type="submit" variant="signal" aria-disabled={adding || undefined}>
            <Plus aria-hidden className="size-4" />
            {COPY.add}
          </Key>
        </div>
      </form>

      {empty ? (
        <div className="flex flex-col gap-1" data-shopping-empty="">
          <p className="bo-text-title">{COPY.emptyTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
        </div>
      ) : null}

      {groups.map((group, index) => (
        <section
          key={group.category}
          aria-labelledby={`${ids}-cat-${index}`}
          className="flex flex-col gap-2"
          data-shopping-category={group.category}
        >
          <h2 id={`${ids}-cat-${index}`} className="bo-text-title">
            {group.label}
            <span className="bo-text-label ml-2 text-text-secondary">
              {COPY.count(group.products.length)}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {group.products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                busy={saving.has(product.id)}
                onToggle={() => toggleBought(product)}
                onRemove={() => remove(product)}
                onQuantity={(value) => saveQuantity(product, value)}
              />
            ))}
          </ul>
        </section>
      ))}

      <section
        aria-labelledby={`${ids}-bought`}
        className="flex flex-col gap-2"
        data-shopping-bought=""
      >
        <details>
          <summary id={`${ids}-bought`} className="bo-text-title min-h-11 cursor-pointer">
            {COPY.boughtTitle}
            <span className="bo-text-label ml-2 text-text-secondary">
              {COPY.boughtCount(bought.length)}
            </span>
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {bought.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                busy={saving.has(product.id)}
                onToggle={() => toggleBought(product)}
                onRemove={() => remove(product)}
                onQuantity={(value) => saveQuantity(product, value)}
              />
            ))}
          </ul>
        </details>
        <Key
          variant="signal"
          size="lg"
          block
          data-shopping-focus="finish"
          aria-disabled={bought.length === 0 || finishing || undefined}
          onClick={finish}
        >
          {bought.length === 0 ? COPY.finishNone : COPY.finish}
        </Key>
      </section>

      <section
        aria-labelledby={`${ids}-saved`}
        className="flex flex-col gap-2"
        data-shopping-saved=""
      >
        <details>
          <summary id={`${ids}-saved`} className="bo-text-title min-h-11 cursor-pointer">
            {COPY.savedTitle}
            <span className="bo-text-label ml-2 text-text-secondary">
              {COPY.count(known.length)}
            </span>
          </summary>
          <p className="bo-text-body-sm mt-1 text-text-secondary">{COPY.savedHelp}</p>
          {known.length === 0 ? (
            <p className="bo-text-body-sm mt-2">{COPY.savedEmpty}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {known.map((product) => (
                <li
                  key={product.id}
                  data-shopping-row={product.id}
                  className="bo-card flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <p className="bo-text-body min-w-0 flex-1 break-words">
                    {product.name}
                    <span className="bo-text-label ml-2 text-text-secondary">
                      {CATEGORY_LABELS[product.category]}
                    </span>
                  </p>
                  <div className="flex items-center gap-1">
                    <Key
                      variant="default"
                      aria-label={COPY.savedAdd(product.name)}
                      aria-disabled={saving.has(product.id) || undefined}
                      data-shopping-focus={`row:${product.id}`}
                      onClick={() => {
                        if (!saving.has(product.id)) putOnList(product);
                      }}
                    >
                      {COPY.add}
                    </Key>
                    <Key
                      variant="ghost"
                      aria-label={COPY.forgetName(product.name)}
                      aria-disabled={saving.has(product.id) || undefined}
                      onClick={() => {
                        if (!saving.has(product.id)) forget(product);
                      }}
                    >
                      {COPY.forget}
                    </Key>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}

type ProductRowProps = {
  product: ShoppingProduct;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onQuantity: (value: string) => boolean;
};

/** One product on the list or checked off: «Comprado», its name, an editable quantity and «Quitar». */
function ProductRow({ product, busy, onToggle, onRemove, onQuantity }: ProductRowProps) {
  const checked = product.status === "bought";
  return (
    <li
      data-shopping-row={product.id}
      className={cn("bo-card flex flex-wrap items-center gap-2 p-3", checked && "opacity-70")}
    >
      <Key
        toggle
        pressed={checked}
        aria-label={COPY.boughtName(product.name)}
        aria-disabled={busy || undefined}
        data-shopping-focus={`row:${product.id}`}
        onPressedChange={() => {
          if (!busy) onToggle();
        }}
      >
        {COPY.bought}
      </Key>
      <p
        className={cn(
          "bo-text-body min-w-0 flex-1 break-words font-medium",
          checked && "line-through",
        )}
      >
        {product.name}
      </p>
      <QuantityField product={product} onCommit={onQuantity} />
      <Key
        variant="ghost"
        aria-label={COPY.removeName(product.name)}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onRemove();
        }}
      >
        {COPY.remove}
      </Key>
    </li>
  );
}

/** The quantity of a row: saved on Enter or when the field loses focus, only if it changed. */
function QuantityField({
  product,
  onCommit,
}: {
  product: ShoppingProduct;
  /** Whether the change was taken: false when the product is still saving or the day changed. */
  onCommit: (value: string) => boolean;
}) {
  const [value, setValue] = useState(product.quantity ?? "");
  // The saved value changed (a refusal, another tab): the field shows it. Not a `key`: remounting
  // would drop focus right after Enter saves.
  const [seen, setSeen] = useState(product.quantity);
  if (seen !== product.quantity) {
    setSeen(product.quantity);
    setValue(product.quantity ?? "");
  }

  function commit() {
    const next = value.trim();
    if (next === (product.quantity ?? "")) {
      setValue(product.quantity ?? "");
      return;
    }
    // Not taken (the product is still saving): the field goes back to what is saved, never shows
    // a value that was not sent.
    if (!onCommit(next)) setValue(product.quantity ?? "");
  }

  return (
    <input
      type="text"
      aria-label={COPY.quantityName(product.name)}
      placeholder={COPY.quantityLabel}
      autoComplete="off"
      maxLength={60}
      value={value}
      className="bo-field__control w-28"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        // Enter saves and stays in the field: the keyboard user keeps their place.
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
