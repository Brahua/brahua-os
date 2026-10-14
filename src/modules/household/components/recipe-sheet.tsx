"use client";

import { useId, useRef, useState } from "react";
import { Key, Sheet, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { MEAL_TYPES, RECIPE_WEEKDAYS, type MealType } from "../recipe-constants";
import { MEAL_LABELS, RECIPE_COPY as COPY, WEEKDAY_LABELS, WEEKDAY_SHORT } from "../recipe-copy";
import { RECIPE_FIELDS, recipeFieldsSchema } from "../recipe-input";
import type { RecipeItem } from "../recipe-view";
import type { ActionResult } from "@/lib/action-result";

type RecipeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The recipe being edited; null to add one. */
  recipe: RecipeItem | null;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** Saves through the screen's queue and answers with the action's result. */
  save: (input: unknown) => Promise<ActionResult<RecipeItem>>;
  onSaved: (recipe: RecipeItem) => void;
};

type Errors = Partial<Record<(typeof RECIPE_FIELDS)[number], string>>;

/**
 * «Añadir receta» / «Editar receta» (SPEC-household "Pantallas"): a name, the meals and weekdays it
 * suits (toggle keys) and an optional link. The same sheet the lists use (bottom on the phone, side
 * panel on the desktop). It stays open with the error on its field when the save is refused, and
 * closes when it is saved. The parent mounts it afresh for each recipe (a `key`), so the fields
 * start from the recipe without effects.
 */
export function RecipeSheet({
  open,
  onOpenChange,
  recipe,
  returnFocusRef,
  onClosed,
  save,
  onSaved,
}: RecipeSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(recipe?.name ?? "");
  const [meals, setMeals] = useState<MealType[]>(recipe?.mealTypes ?? []);
  const [days, setDays] = useState<number[]>(recipe?.weekdays ?? []);
  const [url, setUrl] = useState(recipe?.url ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  function focusField(field: keyof Errors) {
    document.getElementById(`${ids}-${field}`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = {
      ...(recipe ? { id: recipe.id } : {}),
      name,
      mealTypes: meals,
      weekdays: days,
      url,
    };
    const parsed = recipeFieldsSchema.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Errors;
        next[field] ??= issue.message;
      }
      setErrors(next);
      const first = RECIPE_FIELDS.find((field) => next[field]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await save(input);
    setSaving(false);
    if (!result.ok) {
      const next: Errors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        // Only the sheet's own fields have a place to show it; the rest falls back below.
        if ((RECIPE_FIELDS as readonly string[]).includes(field))
          next[field as keyof Errors] = messages[0];
      }
      if (Object.keys(next).length === 0) next.name = result.error;
      setErrors(next);
      const first = RECIPE_FIELDS.find((field) => next[field]);
      if (first) focusField(first);
      return;
    }
    onSaved(result.data);
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={recipe ? COPY.sheetEditTitle : COPY.sheetAddTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={isDesktop ? nameInput : undefined}
      focusTitleOnOpen={!isDesktop}
      closeDisabled={saving}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
          >
            {COPY.save}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
        <TextField
          ref={nameInput}
          id={`${ids}-name`}
          label={COPY.nameLabel}
          placeholder={COPY.namePlaceholder}
          autoComplete="off"
          value={name}
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => ({ ...current, name: undefined }));
          }}
        />
        <fieldset
          id={`${ids}-mealTypes`}
          tabIndex={-1}
          className={cn("bo-field outline-none", errors.mealTypes && "is-error")}
        >
          <legend className="bo-field__label mb-2">{COPY.mealsLegend}</legend>
          <div className="flex flex-wrap gap-2">
            {MEAL_TYPES.map((meal) => (
              <Key
                key={meal}
                toggle
                pressed={meals.includes(meal)}
                data-meal={meal}
                onPressedChange={(pressed) =>
                  setMeals((current) =>
                    pressed ? [...current, meal] : current.filter((value) => value !== meal),
                  )
                }
              >
                {MEAL_LABELS[meal]}
              </Key>
            ))}
          </div>
          {errors.mealTypes ? <span className="bo-field__error">{errors.mealTypes}</span> : null}
        </fieldset>
        <fieldset
          id={`${ids}-weekdays`}
          tabIndex={-1}
          className={cn("bo-field outline-none", errors.weekdays && "is-error")}
        >
          <legend className="bo-field__label mb-2">{COPY.daysLegend}</legend>
          <div className="grid grid-cols-7 gap-1">
            {RECIPE_WEEKDAYS.map((day) => (
              <Key
                key={day}
                toggle
                pressed={days.includes(day)}
                className="min-w-0 px-0"
                aria-label={WEEKDAY_LABELS[day - 1]}
                data-weekday={day}
                onPressedChange={(pressed) =>
                  setDays((current) =>
                    pressed ? [...current, day] : current.filter((value) => value !== day),
                  )
                }
              >
                <span aria-hidden>{WEEKDAY_SHORT[day - 1]}</span>
              </Key>
            ))}
          </div>
          {errors.weekdays ? <span className="bo-field__error">{errors.weekdays}</span> : null}
        </fieldset>
        <TextField
          id={`${ids}-url`}
          label={COPY.urlLabel}
          help={COPY.urlHelp}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          value={url}
          error={errors.url}
          onChange={(event) => {
            setUrl(event.target.value);
            setErrors((current) => ({ ...current, url: undefined }));
          }}
        />
      </form>
    </Sheet>
  );
}
