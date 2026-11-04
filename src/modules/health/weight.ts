// How a set's values are typed and shown (SPEC-health "Serie"). Client-safe and pure.
//
// - Weight: kilos as typed («82,5», «82.5», «82»), at most 2 decimals, a multiple of 0.25 kg,
//   0–1000 kg; stored in whole grams (82 500). Shown «82,5» (and «82,5 kg» with the unit).
// - Distance: kilometres as typed («3,2»), at most 3 decimals, 0–1000 km; stored in meters.
// - Time: «m:ss» or «h:mm:ss», or a whole number: seconds for `time` (a plank's «45»), minutes
//   for `cardio` (the treadmill's «20»), the same units E1's targets use. Shown «0:45», «20:00».
import {
  DISTANCE_MAX_METERS,
  SET_SECONDS_MAX,
  SET_SECONDS_MIN,
  WEIGHT_MAX_GRAMS,
  WEIGHT_STEP_GRAMS,
} from "./health-constants";

export type Parsed<T> = { ok: true; value: T } | { ok: false };

const DECIMAL = /^(\d*)(?:[.,](\d*))?$/;

/** A decimal as typed, in thousandths (at most `maxDecimals` decimals), or null. */
function thousandths(text: string, maxDecimals: number): number | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > maxDecimals) return null;
  const digits = whole.replace(/^0+/, "");
  // 7 whole digits is far past any limit here: no overflow and a clear refusal.
  if (digits.length > 7) return null;
  return Number(digits || "0") * 1000 + Number(fraction.padEnd(3, "0"));
}

/** A weight as typed, in grams: «82,5» → 82 500. «0» is valid (a bodyweight set). */
export function parseWeight(text: string): Parsed<number> {
  const grams = thousandths(text, 2);
  if (grams === null || grams > WEIGHT_MAX_GRAMS || grams % WEIGHT_STEP_GRAMS !== 0) {
    return { ok: false };
  }
  return { ok: true, value: grams };
}

/** Whether `grams` can be stored (a whole number of steps within the range). */
export function isValidGrams(grams: number): boolean {
  return (
    Number.isSafeInteger(grams) &&
    grams >= 0 &&
    grams <= WEIGHT_MAX_GRAMS &&
    grams % WEIGHT_STEP_GRAMS === 0
  );
}

/** Thousandths as a Spanish decimal without trailing zeros: 82 500 → «82,5», 3 200 → «3,2». */
function decimal(thousandthsValue: number): string {
  const whole = Math.floor(thousandthsValue / 1000);
  const fraction = String(thousandthsValue % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

/** Grams as the weight field and the lines show them: «82,5». */
export function formatWeight(grams: number): string {
  return decimal(grams);
}

/** «82,5 kg». */
export function formatKg(grams: number): string {
  return `${decimal(grams)} kg`;
}

/** A distance as typed, in meters: «3,2» → 3 200. */
export function parseDistance(text: string): Parsed<number> {
  const meters = thousandths(text, 3);
  if (meters === null || meters > DISTANCE_MAX_METERS) return { ok: false };
  return { ok: true, value: meters };
}

/** Meters as the distance field shows them: «3,2». */
export function formatDistance(meters: number): string {
  return decimal(meters);
}

/** «3,2 km». */
export function formatKm(meters: number): string {
  return `${decimal(meters)} km`;
}

const CLOCK = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/;

/**
 * A time as typed, in seconds: «1:30», «1:02:03», or a whole number in `plainUnit` (seconds for
 * `time`, minutes for `cardio`). 1 s – 10 h.
 */
export function parseDuration(text: string, plainUnit: "seconds" | "minutes"): Parsed<number> {
  const trimmed = text.trim();
  let seconds: number;
  if (/^\d{1,5}$/.test(trimmed)) {
    seconds = Number(trimmed) * (plainUnit === "minutes" ? 60 : 1);
  } else {
    const match = CLOCK.exec(trimmed);
    if (!match) return { ok: false };
    const [, hours, minutes, secs] = match;
    if (Number(secs) > 59) return { ok: false };
    if (hours !== undefined && Number(minutes) > 59) return { ok: false };
    seconds = Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(secs);
  }
  if (seconds < SET_SECONDS_MIN || seconds > SET_SECONDS_MAX) return { ok: false };
  return { ok: true, value: seconds };
}

/** Seconds as a clock: «0:45», «20:00», «1:02:03». */
export function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Repetitions as typed: a whole number 1–999. */
export function parseReps(text: string): Parsed<number> {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return value >= 1 ? { ok: true, value } : { ok: false };
}
