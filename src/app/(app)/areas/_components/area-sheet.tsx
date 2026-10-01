"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  AreaTag,
  Icon,
  Key,
  Sheet,
  TextField,
  type AreaColor,
  type AreaIconName,
} from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { createLifeArea, updateLifeArea } from "@/modules/core/actions";
import { AREA_ICON_LABELS, AREAS_COPY } from "@/modules/core/areas-copy";
import { AreaColorPicker, AreaIconPicker } from "@/modules/core/components/area-pickers";
import { focusRadioGrid } from "@/modules/core/components/radio-grid";
import {
  LIFE_AREA_FIELDS,
  lifeAreaInputSchema,
  normalizeAreaName,
  type LifeAreaField,
  type LifeAreaSummary,
} from "@/modules/core/life-area-input";

// Same breakpoint as the shell (Tailwind `lg`): side panel next to the sidebar, bottom sheet below.
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True from 1024 px. The sheet only opens after hydration, so the server value never shows. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

export type AreaSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The area being edited, or null to create one. */
  area: LifeAreaSummary | null;
  /** Where focus goes when the sheet closes (the trigger or the edited row). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onSaved: (area: LifeAreaSummary, mode: "created" | "updated") => void;
  /** The sheet finished closing (see `Sheet`'s `onClosed`). */
  onClosed?: () => void;
};

type Errors = Partial<Record<LifeAreaField, string>>;

function firstErrors(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of LIFE_AREA_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/**
 * Create or edit a life area: name, palette and icon, with a live preview. Validates on the
 * client with the actions' own schema, then the Server Action validates again (the authority).
 * Each invalid field shows its message (aria-invalid + aria-describedby) and focus moves to the
 * first one.
 */
export function AreaSheet({
  open,
  onOpenChange,
  area,
  returnFocusRef,
  onSaved,
  onClosed,
}: AreaSheetProps) {
  const isDesktop = useIsDesktop();
  const [name, setName] = useState(area?.name ?? "");
  const [color, setColor] = useState<AreaColor | null>(area?.color ?? null);
  const [icon, setIcon] = useState<AreaIconName | null>(area?.icon ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by a failed submit; the next commit moves focus to the first invalid field.
  const focusFirstInvalid = useRef(false);

  const ids = useId();
  const formId = `${ids}-form`;
  const nameInput = useRef<HTMLInputElement>(null);
  const colorGroup = useRef<HTMLDivElement>(null);
  const iconGroup = useRef<HTMLDivElement>(null);

  // Runs after every commit but only acts right after a failed submit, so editing a field
  // (which clears its error) never moves focus.
  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = LIFE_AREA_FIELDS.find((field) => errors[field]);
    if (first === "name") nameInput.current?.focus();
    else if (first === "color") focusRadioGrid(colorGroup.current);
    else if (first === "icon") focusRadioGrid(iconGroup.current);
  });

  // While saving, the sheet stays open (Esc, the scrim, ✕ and Cancelar do nothing): closing it
  // would hide the result, and a late success must not close a sheet opened afterwards.
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = firstErrors(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    // Field messages speak for themselves. Anything else goes on top: a message about a field
    // the form doesn't show (e.g. the id), else the general error (session, network).
    const other = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
    setFormError(Object.keys(fieldErrors).length > 0 ? null : (other ?? result.error));
  }

  function clearError(field: LifeAreaField) {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = lifeAreaInputSchema.safeParse({ name, color, icon });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<LifeAreaSummary>;
      try {
        result = area
          ? await updateLifeArea({ ...parsed.data, id: area.id })
          : await createLifeArea(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(AREAS_COPY.unexpected);
      }
      if (result.ok) onSaved(result.data, area ? "updated" : "created");
      else showErrors(result);
    });
  }

  const colorLabelId = `${ids}-color-label`;
  const colorErrorId = `${ids}-color-error`;
  const iconLabelId = `${ids}-icon-label`;
  const iconHintId = `${ids}-icon-hint`;
  const iconErrorId = `${ids}-icon-error`;
  const preview = normalizeAreaName(name);

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      onClosed={onClosed}
      variant={isDesktop ? "side" : "bottom"}
      title={area ? AREAS_COPY.editArea : AREAS_COPY.newArea}
      returnFocusRef={returnFocusRef}
      // Keeps focused fields clear of the sticky preview when the body scrolls (WCAG 2.4.11).
      // On short screens the preview doesn't stick, so no padding is needed.
      bodyClassName="scroll-pt-28 [@media(max-height:500px)]:scroll-pt-0"
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {AREAS_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
          >
            {pending ? AREAS_COPY.saving : area ? AREAS_COPY.save : AREAS_COPY.create}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        {/* Sticky, so the preview stays in view while scrolling through the icons (static on
            short screens, where it would take most of the space). The panel-colored shadow covers
            the body's top padding, where content would scroll by. */}
        <div className="sticky top-0 z-10 bg-panel pb-1 shadow-[0_-24px_0_var(--color-panel)] [@media(max-height:500px)]:static [@media(max-height:500px)]:shadow-none">
          <div className="bo-card items-start gap-2">
            <span className="bo-field__label">{AREAS_COPY.previewLabel}</span>
            <div className="flex min-h-5 max-w-full items-center">
              {color && icon ? (
                <AreaTag
                  area={color}
                  icon={icon}
                  label={preview || AREAS_COPY.previewPlaceholder}
                  variant="large"
                  className="max-w-full [&>span:last-child]:line-clamp-2 [&>span:last-child]:break-words"
                />
              ) : (
                <p className="bo-text-body-sm text-text-secondary">{AREAS_COPY.previewHint}</p>
              )}
            </div>
          </div>
        </div>

        <TextField
          ref={nameInput}
          label={AREAS_COPY.nameLabel}
          name="name"
          value={name}
          autoComplete="off"
          autoFocus
          required
          error={errors.name}
          help={AREAS_COPY.nameHelp}
          id={`${ids}-name`}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) clearError("name");
          }}
        />

        <div className={cn("bo-field", errors.color && "is-error")}>
          <span id={colorLabelId} className="bo-field__label">
            {AREAS_COPY.colorLabel}
          </span>
          <AreaColorPicker
            ref={colorGroup}
            value={color}
            onValueChange={(value) => {
              setColor(value);
              if (errors.color) clearError("color");
            }}
            labelledBy={colorLabelId}
            describedBy={errors.color ? colorErrorId : undefined}
            errorId={errors.color ? colorErrorId : undefined}
            invalid={Boolean(errors.color)}
          />
          {errors.color ? <FieldError id={colorErrorId} message={errors.color} /> : null}
        </div>

        <div className={cn("bo-field", errors.icon && "is-error")}>
          <div className="flex items-baseline gap-2">
            <span id={iconLabelId} className="bo-field__label">
              {AREAS_COPY.iconLabel}
            </span>
            {/* The name of the picked icon, for sighted users (the radio already says it). */}
            {icon ? (
              <span aria-hidden className="bo-text-body-sm text-text-secondary">
                · {AREA_ICON_LABELS[icon]}
              </span>
            ) : null}
          </div>
          <AreaIconPicker
            ref={iconGroup}
            value={icon}
            onValueChange={(value) => {
              setIcon(value);
              if (errors.icon) clearError("icon");
            }}
            labelledBy={iconLabelId}
            describedBy={errors.icon ? `${iconHintId} ${iconErrorId}` : iconHintId}
            errorId={errors.icon ? iconErrorId : undefined}
            invalid={Boolean(errors.icon)}
          />
          <span id={iconHintId} className="bo-field__help">
            {AREAS_COPY.iconHint}
          </span>
          {errors.icon ? <FieldError id={iconErrorId} message={errors.icon} /> : null}
        </div>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span id={id} className="bo-field__error">
      <Icon icon={TriangleAlert} size="sm" />
      {message}
    </span>
  );
}
