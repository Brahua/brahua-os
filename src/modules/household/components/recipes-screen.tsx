"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { startTransition, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { addRecipe, editRecipe, removeRecipe, undoRemoveRecipe } from "../recipe-actions";
import { MEAL_TYPES, type MealType } from "../recipe-constants";
import { MEAL_LABELS, RECIPE_COPY as COPY, WEEKDAY_ABBR, WEEKDAY_LABELS } from "../recipe-copy";
import { acceptableRecipeUrl, recipeDomain } from "../recipe-url";
import {
  filterRecipes,
  isoWeekday,
  mealsText,
  recipesForToday,
  type RecipeItem,
} from "../recipe-view";
import { recipesPath } from "../routes";
import { RecipeSheet } from "./recipe-sheet";

type RecipesScreenProps = {
  /** Every live recipe, as the server read them. */
  recipes: readonly RecipeItem[];
  /** The Lima day the page was read for (YYYY-MM-DD): «Para hoy» follows its weekday. */
  today: string;
  /** The filters of the URL: a meal and an ISO weekday, or null. */
  meal: MealType | null;
  day: number | null;
};

/** The server's message for a failed result: a field's own when it gives one, else the general. */
function reasonOf(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/**
 * The recipes (SPEC-household "Pantallas"): «Para hoy» (the ones suggested for today's weekday), the
 * filters by meal and by day (links: they live in the URL), and every recipe with its link, its
 * meals and its days. «Añadir receta» and «Editar» open the same sheet; «Quitar» is optimistic with
 * «Deshacer».
 *
 * - The filters are plain links (`aria-current` on the active one, which clears itself when tapped):
 *   going back and sharing the URL keep them.
 * - «Quitar» hides the row at once and saves in the screen's queue; a refusal brings it back with
 *   «Sin guardar». A second press on a row already saving does nothing (a guard plus
 *   `aria-disabled`).
 * - A link opens in a new tab with `rel="noopener noreferrer"`; the server never follows it.
 */
export function RecipesScreen({ recipes, today, meal, day }: RecipesScreenProps) {
  const { toaster, enqueue, announce, isCurrentDay } = useRequiredScreenServices();
  const { push } = toaster;
  const ids = useId();
  const addKey = useRef<HTMLButtonElement>(null);
  const inflight = useRef(new Set<string>());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  // The sheet: `null` = not mounted; a recipe or `"new"` while it is (it is keyed, so each one
  // starts from its own fields), `open` apart so it can animate out before it unmounts.
  const [sheet, setSheet] = useState<RecipeItem | "new" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** The key that gets focus once the row that had it left (see `neighborFocus`). */
  const pendingFocus = useRef<{ target: string; scope: string | null } | null>(null);
  /** The recipe and key that last had focus: where it goes back if that row leaves (see below). */
  const lastFocus = useRef<{ id: string; key: string } | null>(null);
  /** What to announce when the sheet has closed (the page is `aria-hidden` while it is open). */
  const pendingAnnounce = useRef<string | null>(null);

  const visible = useMemo(() => recipes.filter((recipe) => !gone.has(recipe.id)), [recipes, gone]);
  const forToday = useMemo(() => recipesForToday(visible, today), [visible, today]);
  const shown = useMemo(() => filterRecipes(visible, meal, day), [visible, meal, day]);
  const weekday = isoWeekday(today);
  const filtered = meal !== null || day !== null;

  // After a row left: focus goes where the key that was pressed has no row to be in.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const key = `[data-recipes-focus="${pending.target}"]`;
    // The same recipe is in «Para hoy» and in the list: prefer the one the key was pressed in.
    const element =
      (pending.scope
        ? root.current?.querySelector<HTMLElement>(`${pending.scope} ${key}`)
        : null) ?? root.current?.querySelector<HTMLElement>(key);
    (element ?? addKey.current)?.focus();
  }, [gone]);

  // The server's recipes changed (a save came back): a focused key whose row left (an edit took
  // the recipe out of «Para hoy») dropped focus on the page; it goes to the same recipe in the
  // list it still is in, or to «Añadir receta».
  useLayoutEffect(() => {
    const last = lastFocus.current;
    if (!last) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const element = root.current?.querySelector<HTMLElement>(
      `[data-recipe-row="${last.id}"] ${last.key}`,
    );
    (element ?? addKey.current)?.focus();
  }, [recipes]);

  /**
   * Where focus goes when the row that has it leaves: the «Quitar» of the row next to it in its own
   * list, else «Añadir receta»; with the list it was pressed in (`scope`), so it stays there.
   */
  function neighborFocus(): { target: string; scope: string | null } {
    const row = document.activeElement?.closest<HTMLElement>("[data-recipe-row]");
    const section = row?.closest<HTMLElement>("[data-recipes-today], [data-recipes-all]");
    const scope = section?.hasAttribute("data-recipes-today")
      ? "[data-recipes-today]"
      : section
        ? "[data-recipes-all]"
        : null;
    const rows = [
      ...(row?.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-recipe-row]") ?? []),
    ];
    const at = row ? rows.indexOf(row) : -1;
    const neighbor = rows[at + 1] ?? rows[at - 1];
    const id = neighbor?.getAttribute("data-recipe-row");
    return { target: id ? `row:${id}` : "add", scope };
  }

  function openSheet(target: RecipeItem | "new", opener: HTMLElement | null) {
    returnFocus.current = opener;
    setSheet(target);
    setSheetOpen(true);
  }

  async function saveWithQueue(input: unknown): Promise<ActionResult<RecipeItem>> {
    const isEdit = typeof input === "object" && input !== null && "id" in input;
    const queued = await enqueue(null, () => (isEdit ? editRecipe(input) : addRecipe(input)));
    return queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
  }

  function remove(recipe: RecipeItem) {
    if (isCurrentDay && !isCurrentDay()) return;
    if (inflight.current.has(recipe.id)) return;
    inflight.current.add(recipe.id);
    setSaving((current) => new Set(current).add(recipe.id));
    const next = neighborFocus();
    pendingFocus.current = next;
    const failScope = next.scope;
    setGone((current) => new Set(current).add(recipe.id));
    startTransition(async () => {
      const queued = await enqueue(null, () => removeRecipe({ id: recipe.id }));
      inflight.current.delete(recipe.id);
      setSaving((current) => {
        const next = new Set(current);
        next.delete(recipe.id);
        return next;
      });
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        pendingFocus.current = { target: `row:${recipe.id}`, scope: failScope };
        setGone((current) => {
          const next = new Set(current);
          next.delete(recipe.id);
          return next;
        });
        push({
          title: COPY.notSavedTitle,
          text: `${COPY.notRemoved} ${reasonOf(result)}`.trim(),
          tone: "error",
        });
        return;
      }
      push({
        title: COPY.removedTitle,
        text: COPY.removed(recipe.name),
        action: { label: COPY.undo, run: () => undoRemove(recipe) },
      });
    });
  }

  function undoRemove(recipe: RecipeItem) {
    startTransition(async () => {
      const queued = await enqueue(null, () => undoRemoveRecipe({ id: recipe.id }));
      const result = queued.kind === "done" ? queued.value : fail(COPY.checkConnection);
      if (!result.ok) {
        push({
          title: COPY.notSavedTitle,
          text: `${COPY.notUndone} ${reasonOf(result)}`.trim(),
          tone: "error",
        });
        return;
      }
      setGone((current) => {
        const next = new Set(current);
        next.delete(recipe.id);
        return next;
      });
      announce(COPY.restored(recipe.name));
    });
  }

  const renderRow = (recipe: RecipeItem) => (
    <RecipeRow
      key={recipe.id}
      recipe={recipe}
      busy={saving.has(recipe.id)}
      onEdit={(opener) => openSheet(recipe, opener)}
      onRemove={() => remove(recipe)}
    />
  );

  return (
    <div
      ref={root}
      className="flex max-w-160 flex-col gap-6"
      data-household-view="recetas"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>("[data-recipe-row]");
        const key = target.hasAttribute("data-recipes-edit")
          ? "[data-recipes-edit]"
          : target.hasAttribute("data-recipes-focus")
            ? "[data-recipes-focus]"
            : null;
        lastFocus.current =
          row && key ? { id: row.getAttribute("data-recipe-row") ?? "", key } : null;
      }}
    >
      <div className="flex justify-end">
        <Key
          ref={addKey}
          variant="signal"
          data-recipes-add=""
          data-recipes-focus="add"
          onClick={() => openSheet("new", addKey.current)}
        >
          <Plus aria-hidden className="size-4" />
          {COPY.add}
        </Key>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col gap-1" data-recipes-empty="">
          <p className="bo-text-title">{COPY.emptyTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
        </div>
      ) : (
        <>
          <section
            aria-labelledby={`${ids}-today`}
            className="flex flex-col gap-2"
            data-recipes-today=""
          >
            <h2 id={`${ids}-today`} className="bo-text-title">
              {COPY.forToday(WEEKDAY_LABELS[weekday - 1].toLowerCase())}
            </h2>
            {forToday.length === 0 ? (
              <p className="bo-text-body-sm text-text-secondary">{COPY.nothingToday}</p>
            ) : (
              <ul className="flex flex-col gap-2">{forToday.map(renderRow)}</ul>
            )}
          </section>

          <section
            aria-labelledby={`${ids}-all`}
            className="flex flex-col gap-3"
            data-recipes-all=""
          >
            <h2 id={`${ids}-all`} className="bo-text-title">
              {COPY.all}
              <span className="bo-text-label ml-2 text-text-secondary">
                {COPY.count(shown.length)}
              </span>
            </h2>
            <nav aria-label={COPY.filtersLabel} className="flex flex-col gap-2">
              <FilterGroup label={COPY.mealFilter}>
                {MEAL_TYPES.map((value) => (
                  <FilterLink
                    key={value}
                    label={MEAL_LABELS[value]}
                    active={meal === value}
                    href={recipesPath(meal === value ? null : value, day)}
                  />
                ))}
              </FilterGroup>
              <FilterGroup label={COPY.dayFilter}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <FilterLink
                    key={label}
                    label={label}
                    active={day === index + 1}
                    href={recipesPath(meal, day === index + 1 ? null : index + 1)}
                  />
                ))}
              </FilterGroup>
              {filtered ? (
                <p>
                  <Link
                    href={recipesPath()}
                    className="bo-text-body-sm rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {COPY.clearFilters}
                  </Link>
                </p>
              ) : null}
            </nav>
            {shown.length === 0 ? (
              <div className="flex flex-col gap-1" data-recipes-no-match="">
                <p className="bo-text-body font-medium">{COPY.noMatchTitle}</p>
                <p className="bo-text-body-sm text-text-secondary">{COPY.noMatchText}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2" data-recipes-list="">
                {shown.map(renderRow)}
              </ul>
            )}
          </section>
        </>
      )}

      {sheet !== null ? (
        <RecipeSheet
          key={sheet === "new" ? "new" : sheet.id}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          recipe={sheet === "new" ? null : sheet}
          returnFocusRef={returnFocus}
          onClosed={() => {
            // The opener may be gone (an edit that took the recipe out of this list): focus goes to
            // the same recipe's «Editar», or to «Añadir receta».
            if (returnFocus.current && !returnFocus.current.isConnected) {
              const id = sheet !== "new" && sheet !== null ? sheet.id : null;
              const edit = id
                ? root.current?.querySelector<HTMLElement>(
                    `[data-recipe-row="${id}"] [data-recipes-edit]`,
                  )
                : null;
              (edit ?? addKey.current)?.focus();
            }
            if (pendingAnnounce.current) announce(pendingAnnounce.current);
            pendingAnnounce.current = null;
            setSheet(null);
          }}
          save={saveWithQueue}
          onSaved={(saved) => {
            pendingAnnounce.current =
              sheet === "new" ? COPY.added(saved.name) : COPY.saved(saved.name);
          }}
        />
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="bo-text-label text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

/** A filter chip: a link (44 px) that marks itself with `aria-current` and clears itself on a tap. */
function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      aria-label={COPY.filterName(label)}
      className={cn(
        "bo-text-body-sm flex min-h-11 items-center rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        active ? "border-signal" : "border-divider text-text-secondary",
      )}
    >
      {label}
    </Link>
  );
}

type RecipeRowProps = {
  recipe: RecipeItem;
  busy: boolean;
  onEdit: (opener: HTMLElement | null) => void;
  onRemove: () => void;
};

/** One recipe: its name (a link when it has one), its meals, days and domain, «Editar» and «Quitar». */
function RecipeRow({ recipe, busy, onEdit, onRemove }: RecipeRowProps) {
  const edit = useRef<HTMLButtonElement>(null);
  const href = recipe.url ? acceptableRecipeUrl(recipe.url) : null;
  const domain = recipe.url ? recipeDomain(recipe.url) : null;
  const meta = [
    mealsText(recipe),
    recipe.weekdays.map((value) => WEEKDAY_ABBR[value - 1]).join(" "),
  ].filter(Boolean);
  return (
    <li data-recipe-row={recipe.id} className="bo-card bo-household-row">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="bo-text-body min-w-0 rounded-sm font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {recipe.name}
            <span className="sr-only"> ({COPY.opensNewTab})</span>
          </a>
        ) : (
          <p className="bo-text-body min-w-0 font-medium break-words">{recipe.name}</p>
        )}
        <p className="bo-text-label text-text-secondary">
          {[...meta, domain ?? COPY.noLink].join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Key
          ref={edit}
          variant="ghost"
          data-recipes-edit=""
          aria-label={COPY.editName(recipe.name)}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onEdit(edit.current);
          }}
        >
          {COPY.edit}
        </Key>
        <Key
          variant="ghost"
          data-recipes-focus={`row:${recipe.id}`}
          aria-label={COPY.removeName(recipe.name)}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onRemove();
          }}
        >
          {COPY.remove}
        </Key>
      </div>
    </li>
  );
}
