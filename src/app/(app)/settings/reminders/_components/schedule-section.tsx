"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Lcd, SectionLabel, Switch, TextField } from "@/design-system";
import { updateReminderSettings } from "@/modules/reminders/actions";
import { SCHEDULE_COPY } from "@/modules/reminders/reminders-copy";
import {
  SETTINGS_ERRORS,
  updateReminderSettingsSchema,
  type ReminderSchedule,
  type UpdateReminderSettingsInput,
} from "@/modules/reminders/settings-input";

type Message = { tone: "status" | "error"; text: string };
type TimeField = "briefingTime" | "eveningTime";
type SwitchField = Exclude<keyof ReminderSchedule, TimeField>;

/**
 * Ajustes → Avisos → Avisos del día: a switch per reminder (briefing, payments, evening review),
 * the time of the two that have one (`type=time`, 48 px or more) and the Telegram amounts switch.
 *
 * A switch saves when it is touched; a time saves when the field is left (or with Intro), so
 * half-typed segments are never sent. One save at a time: while one is in flight the controls say
 * so with `aria-disabled` and a guard (never `disabled`, so the focused control keeps its focus) and
 * a time left meanwhile is saved right after. The result is announced ("Guardado." in a status
 * region, a failure in an alert) and the focus goes back to the control that had it if the save
 * left it nowhere.
 */
export function ScheduleSection({ initial }: { initial: ReminderSchedule }) {
  const headingId = useId();
  const errorId = useId();
  const ids = {
    briefing: useId(),
    briefingTime: useId(),
    payments: useId(),
    evening: useId(),
    eveningTime: useId(),
    amounts: useId(),
  };
  const [saved, setSaved] = useState(initial);
  const [drafts, setDrafts] = useState({
    briefingTime: initial.briefingTime,
    eveningTime: initial.eveningTime,
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  // Switches touched while a save is in flight, merged; the save's `finally` sends them.
  const queued = useRef<UpdateReminderSettingsInput>({});
  // The latest values, for the save that runs after another one (state would be stale there).
  const savedRef = useRef(saved);
  const draftsRef = useRef(drafts);

  useEffect(() => {
    mounted.current = true;
    // Hydration marker: the handlers are attached from here on (the E2E waits for it).
    sectionRef.current?.setAttribute("data-schedule-ready", "true");
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Shows `next` as the saved schedule. The draft of a time field follows it only if that field
   * is in `patch` (just saved or put back); one the owner is typing in meanwhile keeps its draft.
   */
  function show(next: ReminderSchedule, patch: UpdateReminderSettingsInput) {
    savedRef.current = next;
    draftsRef.current = {
      briefingTime: "briefingTime" in patch ? next.briefingTime : draftsRef.current.briefingTime,
      eveningTime: "eveningTime" in patch ? next.eveningTime : draftsRef.current.eveningTime,
    };
    setSaved(next);
    setDrafts(draftsRef.current);
  }

  /** What a failed save goes back to: `before`'s value in each field of `patch`, the rest as is. */
  function revert(before: ReminderSchedule, patch: UpdateReminderSettingsInput): ReminderSchedule {
    const reverted: Record<string, unknown> = { ...savedRef.current };
    for (const key of Object.keys(patch)) {
      reverted[key] = (before as Record<string, unknown>)[key];
    }
    return reverted as ReminderSchedule;
  }

  async function save(patch: UpdateReminderSettingsInput) {
    if (busy.current) return;
    const parsed = updateReminderSettingsSchema.safeParse(patch);
    if (!parsed.success) {
      setMessage({ tone: "error", text: SETTINGS_ERRORS.timeInvalid });
      // Back to what is saved: the field never keeps a time that was not.
      show(savedRef.current, patch);
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage(null);
    const had = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const before = savedRef.current;
    // Optimistic for a switch (a time field already shows its draft).
    show({ ...before, ...patch }, patch);
    try {
      const result = await updateReminderSettings(parsed.data);
      if (!mounted.current) return;
      if (result.ok) {
        // A switch touched meanwhile (queued) stays shown as the owner left it.
        show({ ...result.data, ...queued.current }, patch);
        setMessage({ tone: "status", text: SCHEDULE_COPY.saved });
      } else {
        show(revert(before, patch), patch);
        setMessage({ tone: "error", text: result.error });
      }
    } catch {
      if (mounted.current) {
        show(revert(before, patch), patch);
        setMessage({ tone: "error", text: SCHEDULE_COPY.saveFailed });
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(false);
        // The save may have left the focus nowhere (a re-render): put it back where it was.
        if (had?.isConnected && document.activeElement === document.body) had.focus();
        // What was touched while this one was saving (a switch, a time left) goes out now, in one.
        commitTimes();
      } else {
        queued.current = {};
      }
    }
  }

  /**
   * Saves what is waiting: the switches touched while another save was in flight (`queued`,
   * merged) plus the times whose draft differs from the saved one. One save, no duplicates (a
   * time already sent has its draft equal to the saved value).
   */
  function commitTimes() {
    const patch: UpdateReminderSettingsInput = { ...queued.current };
    for (const field of ["briefingTime", "eveningTime"] as const) {
      const draft = draftsRef.current[field];
      if (draft !== savedRef.current[field]) patch[field] = draft;
    }
    if (Object.keys(patch).length === 0) return;
    if (busy.current) return; // the running save's `finally` comes back here
    queued.current = {};
    void save(patch);
  }

  function toggle(field: SwitchField, next: boolean) {
    // aria-disabled keeps the switch focusable, so the guard lives here: a switch touched while a
    // save is in flight is shown at once and queued, merged with what is already waiting.
    if (busy.current) {
      queued.current = { ...queued.current, [field]: next };
      show({ ...savedRef.current, [field]: next }, {});
      return;
    }
    void save({ [field]: next });
  }

  function editTime(field: TimeField, value: string) {
    draftsRef.current = { ...draftsRef.current, [field]: value };
    setDrafts(draftsRef.current);
  }

  const readOnly = pending || undefined;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex w-full max-w-100 flex-col gap-5"
    >
      <SectionLabel as="h2" id={headingId} tabIndex={-1} title={SCHEDULE_COPY.title} />
      <p className="bo-text-body-sm text-text-secondary">{SCHEDULE_COPY.intro}</p>

      <SwitchRow
        id={ids.briefing}
        label={SCHEDULE_COPY.briefing.label}
        help={SCHEDULE_COPY.briefing.help}
        checked={saved.briefingEnabled}
        pending={pending}
        onChange={(next) => toggle("briefingEnabled", next)}
      />
      <TextField
        label={SCHEDULE_COPY.briefing.time}
        id={ids.briefingTime}
        type="time"
        step={60}
        className="bo-date-field"
        value={drafts.briefingTime}
        readOnly={readOnly}
        aria-disabled={pending}
        onChange={(event) => editTime("briefingTime", event.target.value)}
        onBlur={commitTimes}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitTimes();
        }}
      />

      <SwitchRow
        id={ids.payments}
        label={SCHEDULE_COPY.payments.label}
        help={SCHEDULE_COPY.payments.help}
        checked={saved.paymentsEnabled}
        pending={pending}
        onChange={(next) => toggle("paymentsEnabled", next)}
      />

      <SwitchRow
        id={ids.evening}
        label={SCHEDULE_COPY.evening.label}
        help={SCHEDULE_COPY.evening.help}
        checked={saved.eveningEnabled}
        pending={pending}
        onChange={(next) => toggle("eveningEnabled", next)}
      />
      <TextField
        label={SCHEDULE_COPY.evening.time}
        id={ids.eveningTime}
        type="time"
        step={60}
        className="bo-date-field"
        value={drafts.eveningTime}
        readOnly={readOnly}
        aria-disabled={pending}
        onChange={(event) => editTime("eveningTime", event.target.value)}
        onBlur={commitTimes}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitTimes();
        }}
      />

      <SwitchRow
        id={ids.amounts}
        label={SCHEDULE_COPY.amounts.label}
        help={SCHEDULE_COPY.amounts.help}
        checked={saved.showAmountsTelegram}
        pending={pending}
        onChange={(next) => toggle("showAmountsTelegram", next)}
      />

      {/* Always rendered, so screen readers announce messages as soon as they appear. */}
      <p role="status" className="bo-text-body-sm text-text-secondary">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <div role="alert" aria-atomic="true">
        {message?.tone === "error" ? (
          <Lcd id={errorId} tag={<span aria-hidden>Avisos</span>} live={false}>
            {message.text}
          </Lcd>
        ) : null}
      </div>
    </section>
  );
}

function SwitchRow({
  id,
  label,
  help,
  checked,
  pending,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  pending: boolean;
  onChange: (next: boolean) => void;
}) {
  const helpId = `${id}-help`;
  return (
    // The design system's switch is 30 px high: the row is the 48 px touch target (the label is a
    // real <label>, so tapping its text toggles the switch too).
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        {/* A real <label>: it names the switch and clicking it toggles the switch too. */}
        <label htmlFor={id} className="bo-text-body-strong cursor-pointer">
          {label}
        </label>
        <p id={helpId} className="bo-text-body-sm text-text-secondary">
          {help}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        aria-describedby={helpId}
        aria-disabled={pending}
        onCheckedChange={onChange}
      />
    </div>
  );
}
