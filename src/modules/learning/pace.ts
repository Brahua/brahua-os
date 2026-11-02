// The pace of a track as pure functions (SPEC-learning "Ritmo a la fecha", "Meta semanal").
// Client-safe. Never «atrasado»: a date that passed only asks for another one.
//
// L1: the pace to the target date and the weekly target's text. L2: Lima's week (Monday to
// Sunday; a session counts in the week it STARTED), the week's minutes against the target, the
// timer's duration and the 4 h threshold, and the span of a session written by hand. Every
// function takes its instant or day explicitly (no clock), so the edges are tested with values.
// Lima is UTC-5 all year (no daylight saving, like reminders/slots.ts): a Lima day starts at
// 05:00 UTC.
import { ownerDateKey } from "@/lib/time";
import {
  LONG_SESSION_MINUTES,
  MANUAL_DAYS_BACK,
  SESSION_MAX_MINUTES,
  SESSION_MIN_MINUTES,
} from "./learning-constants";

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

// ── L2: Lima's week ──────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** `day` (YYYY-MM-DD) moved by `days` (negative: earlier), across months and years. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The Monday of the week `day` (a Lima day) is in. */
export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** The instant a Lima day starts (00:00 in Lima = 05:00 UTC). */
export function limaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00-05:00`);
}

/** The week `now` is in, as instants: from its Monday 00:00 (Lima) to the next one, excluded. */
export function weekBounds(now: Date): { weekStart: string; from: Date; to: Date } {
  const weekStart = mondayOf(ownerDateKey(now));
  return { weekStart, from: limaDayStart(weekStart), to: limaDayStart(addDays(weekStart, 7)) };
}

/** The Monday (Lima) of the week a session belongs to: the week it started in. */
export function sessionWeek(startedAt: Date | string): string {
  return mondayOf(ownerDateKey(new Date(startedAt)));
}

/** The first instant a track's page lists sessions from (`weeks` weeks, this one included). */
export function sessionsSince(now: Date, weeks: number): Date {
  return limaDayStart(addDays(weekBounds(now).weekStart, -7 * (weeks - 1)));
}

// ── L2: the weekly target ────────────────────────────────────────────────────────────────────

export type WeekGoal =
  /** No target: only what was studied («1 h 20 esta semana»). */
  | { kind: "free"; minutes: number }
  /** «1 h 20 de 3 h esta semana» and «Te faltan 1 h 40»: what is left, never a debt. */
  | { kind: "progress"; minutes: number; target: number; left: number }
  /** «Semana cumplida». */
  | { kind: "met"; minutes: number; target: number };

/** The week's minutes against the target. Null with no target and nothing studied (says nothing). */
export function weekGoal(minutes: number, target: number | null): WeekGoal | null {
  const studied = Math.max(0, Math.round(minutes));
  if (target === null) return studied > 0 ? { kind: "free", minutes: studied } : null;
  if (studied >= target) return { kind: "met", minutes: studied, target };
  return { kind: "progress", minutes: studied, target, left: target - studied };
}

// ── L2: the timer ────────────────────────────────────────────────────────────────────────────

/** Milliseconds a timer has run at `now` (0 when the clocks disagree and it seems to start later). */
export function elapsedMs(startedAt: Date | string, now: Date | number): number {
  return Math.max(0, Number(now) - new Date(startedAt).getTime());
}

/** Whether a timer that ran `ms` asks to confirm or correct its minutes (more than 4 h). */
export function needsConfirmation(ms: number): boolean {
  return ms > LONG_SESSION_MINUTES * MINUTE_MS;
}

/**
 * The minutes a stopped timer saves without asking: rounded, at least 1 (a tap «Estudiar» then
 * «Detener» still is a session, with «Deshacer»). Only up to 4 h: beyond it the owner confirms.
 */
export function timerMinutes(ms: number): number {
  return Math.min(SESSION_MAX_MINUTES, Math.max(SESSION_MIN_MINUTES, Math.round(ms / MINUTE_MS)));
}

/** The most minutes a confirmation may save: what the timer ran (rounded up), at most 600. */
export function maxConfirmMinutes(ms: number): number {
  return Math.min(SESSION_MAX_MINUTES, Math.max(SESSION_MIN_MINUTES, Math.ceil(ms / MINUTE_MS)));
}

/** The running time as a clock: «4:05» under an hour, «1:02:03» from there. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

// ── L2: «Anotar tiempo» ──────────────────────────────────────────────────────────────────────

/** The days «Anotar tiempo» offers, from today back (today, yesterday … 30 days ago). */
export function manualDays(today: string): string[] {
  return Array.from({ length: MANUAL_DAYS_BACK + 1 }, (_, index) => addDays(today, -index));
}

/** Whether `day` is one «Anotar tiempo» accepts on `today` (not in the future, 30 days back). */
export function isManualDay(day: string, today: string): boolean {
  return day <= today && day >= addDays(today, -MANUAL_DAYS_BACK);
}

/**
 * Where a session written by hand sits in time, so it counts in the week of the day chosen: today,
 * it ends now and starts `minutes` earlier but never before today's 00:00; another day, it starts
 * at that day's noon (Lima) and ends `minutes` later, the same day (600 min end by 22:00).
 */
export function manualSpan(
  day: string,
  minutes: number,
  now: Date,
): { startedAt: Date; endedAt: Date } {
  if (day === ownerDateKey(now)) {
    const start = Math.max(limaDayStart(day).getTime(), now.getTime() - minutes * MINUTE_MS);
    return { startedAt: new Date(start), endedAt: new Date(now.getTime()) };
  }
  const startedAt = new Date(limaDayStart(day).getTime() + 12 * 60 * MINUTE_MS);
  return { startedAt, endedAt: new Date(startedAt.getTime() + minutes * MINUTE_MS) };
}
