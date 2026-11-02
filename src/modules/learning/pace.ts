// The pace of a track as pure functions (SPEC-learning "Ritmo a la fecha", "Meta semanal").
// Client-safe. Never «atrasado»: a date that passed only asks for another one.
//
// L1: the pace to the target date and the weekly target's text. L2 adds Lima's week and the
// minutes of the week here.

/** Days from `from` to `to` (YYYY-MM-DD, calendar days, no time zone): negative when `to` is before. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type Pace =
  /** «Para llegar al 15 dic: ~4 pasos por semana». */
  | { kind: "perWeek"; perWeek: number; targetDate: string }
  /** «La fecha pasó: ponle otra o quítala». */
  | { kind: "passed"; targetDate: string };

type PaceInput = {
  /** YYYY-MM-DD, or null without a target date. */
  targetDate: string | null;
  /** Lima's today, YYYY-MM-DD. */
  today: string;
  /** Live steps of the syllabus, and how many are done. */
  done: number;
  total: number;
};

/**
 * The steps per week that reach the target date: the steps left over the weeks left, both
 * rounded up. The weeks left count today (a date of today is one week: everything left, this
 * week). Null without a date, without a syllabus (a practice, or one not pasted yet) or with every
 * step done. A date before today is `passed`, never a debt.
 */
export function paceToDate({ targetDate, today, done, total }: PaceInput): Pace | null {
  if (!targetDate || total === 0) return null;
  const remaining = total - done;
  if (remaining <= 0) return null;
  const days = daysBetween(today, targetDate);
  if (days < 0) return { kind: "passed", targetDate };
  const weeks = Math.ceil((days + 1) / 7);
  return { kind: "perWeek", perWeek: Math.ceil(remaining / weeks), targetDate };
}

/** Minutes as the screens say them: «45 min», «3 h», «1 h 20». */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/** Minutes as the form's two fields (hours and minutes). */
export function splitMinutes(minutes: number | null): { hours: string; minutes: string } {
  if (minutes === null) return { hours: "", minutes: "" };
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };
}

/**
 * The form's two fields back as minutes: null when both are empty, NaN when either isn't a whole
 * number (the schema then says why).
 */
export function joinMinutes(hours: string, minutes: string): number | null {
  const h = hours.trim();
  const m = minutes.trim();
  if (h === "" && m === "") return null;
  const valid = (value: string) => value === "" || /^\d{1,4}$/.test(value);
  if (!valid(h) || !valid(m)) return Number.NaN;
  return Number(h || 0) * 60 + Number(m || 0);
}
