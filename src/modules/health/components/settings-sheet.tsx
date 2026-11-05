"use client";

import { Check, ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Icon, Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { HEALTH_COPY } from "../health-copy";
import { updateHealthSettings } from "../settings-actions";
import { SETTINGS_COPY as COPY } from "../settings-copy";
import { linkedHabit, type HealthSettingsView } from "../settings-input";
import { failureReason, useHealthSave } from "./use-health-save";

/** The select's value for «Ninguno». */
const NONE = "";

/**
 * «Ajustes» on /health (SPEC-health "Hábito enlazado", E4): a row of the «Más de Entreno» list
 * that says what a finished session marks, and its sheet «Al terminar una sesión, marcar el hábito
 * ___» (a native select: «Ninguno» and the yes/no habits to build, in their order). A stored habit
 * that can't be marked any more shows as «(ya no existe)»; keeping it saves nothing. Saving closes
 * the sheet (focus back on the row) with a notice; a refusal keeps it open with the reason.
 */
export function SettingsRow({ view }: { view: HealthSettingsView }) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const rowKey = useRef<HTMLButtonElement>(null);
  const { send, toaster } = useHealthSave();
  // Shown at once after a save, until the page's next read (revalidated) arrives: a new `view`
  // drops it during render, so the server's answer (also the options after a refusal) wins.
  const [saved, setSaved] = useState<HealthSettingsView | null>(null);
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setSaved(null);
  }
  const current = saved ?? view;
  const linked = linkedHabit(current);
  const [sheet, setSheet] = useState({ key: 0, open: false });
  const [value, setValue] = useState<string>(current.habitId ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open() {
    setValue(current.habitId ?? NONE);
    setError(null);
    setSheet((state) => ({ key: state.key + 1, open: true }));
  }

  async function submit() {
    if (busy) return;
    const habitId = value === NONE ? null : value;
    // Unchanged (also «(ya no existe)» kept): nothing to save.
    if (habitId === current.habitId) {
      setSheet((state) => ({ ...state, open: false }));
      return;
    }
    setBusy(true);
    const result = await send(() => updateHealthSettings({ habitId }));
    setBusy(false);
    if (!result.ok) {
      setError(`${COPY.notSaved} ${failureReason(result)}`);
      return;
    }
    setSaved(result.data);
    setSheet((state) => ({ ...state, open: false }));
    toaster.push({
      title: COPY.savedTitle,
      text: COPY.saved(linkedHabit(result.data).name),
    });
  }

  const describedBy = error ? `${ids}-error` : `${ids}-help`;
  return (
    <li className="bg-surface">
      <button
        ref={rowKey}
        type="button"
        className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-haspopup="dialog"
        data-health-settings-link=""
        onClick={open}
      >
        <Icon icon={SlidersHorizontal} size="md" className="shrink-0 text-text-secondary" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="bo-text-body font-medium">{COPY.link}</span>
          <span className="bo-text-body-sm break-words text-text-secondary">
            {COPY.linkHelp(linked.name, linked.missing)}
          </span>
        </span>
        <Icon icon={ChevronRight} size="sm" className="shrink-0 text-text-secondary" />
      </button>
      <Sheet
        key={`settings-${sheet.key}`}
        open={sheet.open}
        onOpenChange={(next) => {
          if (!busy) setSheet((state) => ({ ...state, open: next }));
        }}
        variant={isDesktop ? "side" : "bottom"}
        title={COPY.title}
        returnFocusRef={rowKey}
        focusTitleOnOpen
        closeDisabled={busy}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          data-health-settings=""
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={error ? "bo-field is-error" : "bo-field"}>
            <label className="bo-field__label" htmlFor={`${ids}-habit`}>
              {COPY.habitLabel}
            </label>
            <div className="bo-select">
              <select
                id={`${ids}-habit`}
                className="bo-field__control"
                value={value}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                data-health-settings-habit=""
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              >
                <option value={NONE}>{COPY.none}</option>
                {linked.missing && current.habitId ? (
                  <option value={current.habitId}>{COPY.missing}</option>
                ) : null}
                {current.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
            </div>
            {error ? (
              <span id={`${ids}-error`} className="bo-field__error" role="alert">
                {error}
              </span>
            ) : (
              <span id={`${ids}-help`} className="bo-field__help">
                {current.options.length === 0 ? COPY.noOptions : COPY.habitHelp}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Key
              type="submit"
              variant="signal"
              icon={Check}
              aria-disabled={busy || undefined}
              data-health-settings-save=""
            >
              {HEALTH_COPY.save}
            </Key>
            <Key
              variant="ghost"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) setSheet((state) => ({ ...state, open: false }));
              }}
            >
              {HEALTH_COPY.cancel}
            </Key>
          </div>
        </form>
      </Sheet>
    </li>
  );
}
