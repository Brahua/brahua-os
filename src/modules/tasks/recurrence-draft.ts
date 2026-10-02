// The recurrence editor's state (T3), pure and client-safe. The editor keeps what is typed as
// text (an interval being retyped is briefly empty) and every rule's fields at once, so switching
// back and forth between rules doesn't lose what was there. `ruleFromDraft` turns it into a rule
// through the same Zod schema the server action runs.
import { ownerDateKey } from "@/lib/time";
import type { RecurrenceMode } from "./recurrence-copy";
import { recurrenceRuleSchema } from "./recurrence-input";
import type { TaskRecurrence } from "./task-input";

export type IntervalUnit = "every_days" | "every_weeks" | "every_months";

export type RecurrenceDraft = {
  mode: RecurrenceMode;
  unit: IntervalUnit;
  interval: string;
  weekdays: number[];
  monthDay: string;
};

export type RecurrenceDraftErrors = Partial<Record<"interval" | "weekdays" | "monthDay", string>>;

/** Lima's weekday (ISO 1–7) and day of the month of an instant. */
function limaToday(now: Date): { weekday: number; day: number } {
  const key = ownerDateKey(now);
  const date = new Date(`${key}T00:00:00Z`);
  return { weekday: date.getUTCDay() === 0 ? 7 : date.getUTCDay(), day: date.getUTCDate() };
}

/**
 * The editor's state for a rule (or none). The rules not in use start from sensible values:
 * every 1 day, today's weekday, today's day of the month (Lima), so picking one is already valid.
 */
export function draftFromRule(rule: TaskRecurrence | null, now: Date): RecurrenceDraft {
  const today = limaToday(now);
  const draft: RecurrenceDraft = {
    mode: "none",
    unit: "every_days",
    interval: "1",
    weekdays: [today.weekday],
    monthDay: String(today.day),
  };
  if (!rule) return draft;
  switch (rule.kind) {
    case "every_days":
    case "every_weeks":
    case "every_months":
      return { ...draft, mode: "every", unit: rule.kind, interval: String(rule.interval ?? 1) };
    case "weekdays":
      return { ...draft, mode: "weekdays", weekdays: rule.weekdays ?? draft.weekdays };
    case "month_day":
      return { ...draft, mode: "month_day", monthDay: String(rule.monthDay ?? today.day) };
  }
}

/** The rule a draft describes, or why it can't be saved yet (per field). */
export function ruleFromDraft(
  draft: RecurrenceDraft,
): { ok: true; rule: TaskRecurrence | null } | { ok: false; errors: RecurrenceDraftErrors } {
  if (draft.mode === "none") return { ok: true, rule: null };
  const input =
    draft.mode === "every"
      ? { kind: draft.unit, interval: draft.interval }
      : draft.mode === "weekdays"
        ? { kind: "weekdays", weekdays: draft.weekdays }
        : { kind: "month_day", monthDay: draft.monthDay };
  const parsed = recurrenceRuleSchema.safeParse(input);
  if (parsed.success) return { ok: true, rule: parsed.data };
  const errors: RecurrenceDraftErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "interval" || field === "weekdays" || field === "monthDay") && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

/** Whether two rules are the same (no save needed). */
export function sameRule(a: TaskRecurrence | null, b: TaskRecurrence | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.interval === b.interval &&
    a.monthDay === b.monthDay &&
    (a.weekdays ?? []).join() === (b.weekdays ?? []).join()
  );
}
