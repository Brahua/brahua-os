// The rest between sets (SPEC-health "Descanso"): it lives in the client, as the instant it ends,
// kept in `sessionStorage` so a reload keeps counting. Client-safe and pure, except the storage
// helpers, which never throw (a private window, blocked storage or a full quota just forget it).
import { REST_STEP_SECONDS } from "./health-constants";

/**
 * The longest a rest can run: the longest rest (10 min) plus room for «+15 s» taps. «+15 s» stops
 * there, and a stored rest beyond it (edited by hand, or from a bug) is ignored.
 */
export const REST_BAR_MAX_SECONDS = 30 * 60;

/** A running rest: when it ends (ms) and how long it was set to (s). */
export type Rest = { endAt: number; total: number };

/** Seconds left, rounded up (0 when over). */
export function restLeft(rest: Rest, now: number): number {
  return Math.max(0, Math.ceil((rest.endAt - now) / 1000));
}

export function startRest(seconds: number, now: number): Rest {
  return { endAt: now + seconds * 1000, total: seconds };
}

/**
 * +15 s or −15 s. Taking it to zero or below ends it without the signal (null): the owner chose
 * to stop resting.
 */
export function adjustRest(rest: Rest, direction: 1 | -1, now: number): Rest | null {
  const endAt = Math.min(
    rest.endAt + direction * REST_STEP_SECONDS * 1000,
    now + REST_BAR_MAX_SECONDS * 1000,
  );
  if (endAt <= now) return null;
  return { endAt, total: Math.max(rest.total, Math.ceil((endAt - now) / 1000)) };
}

const storageKey = (sessionId: string) => `health:rest:${sessionId}`;

/** The rest kept for this session, or null (none, over already, unreadable or malformed). */
export function readRest(sessionId: string, now: number): Rest | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(sessionId));
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<Rest>;
    if (
      typeof value.endAt !== "number" ||
      typeof value.total !== "number" ||
      !Number.isFinite(value.endAt) ||
      !Number.isFinite(value.total) ||
      value.endAt <= now ||
      value.endAt > now + REST_BAR_MAX_SECONDS * 1000 ||
      value.total <= 0 ||
      value.total > REST_BAR_MAX_SECONDS
    ) {
      return null;
    }
    return { endAt: value.endAt, total: value.total };
  } catch {
    return null;
  }
}

/** Keeps (or with null, forgets) the session's rest. Never throws. */
export function writeRest(sessionId: string, rest: Rest | null): void {
  try {
    if (rest === null) window.sessionStorage.removeItem(storageKey(sessionId));
    else window.sessionStorage.setItem(storageKey(sessionId), JSON.stringify(rest));
  } catch {
    // Unavailable storage: the rest still runs, it just won't survive a reload.
  }
}
