// The syllabus of a track as pure functions (SPEC-learning "Supuestos" 2): pasting several lines
// makes one step per line, the next step is the first one not done, and the progress is done of
// all. Client-safe: the sheet previews what the server will store with the same rules.
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { MAX_STEPS_PER_TRACK, STEP_TITLE_MAX_LENGTH } from "./learning-constants";

/** Length in characters as Postgres counts them (code points, not UTF-16 units). */
export const codePoints = (value: string) => [...value].length;

/**
 * A pasted text can be at most this long before it is split (500 lines of 200 characters with
 * room for indentation and blank lines); anything longer is refused without reading it.
 */
export const SYLLABUS_MAX_LENGTH = 200_000;

export type SyllabusResult =
  | { ok: true; titles: string[] }
  | {
      ok: false;
      /** `tooLong` and `invisible` name the line (1-based, as pasted, blank lines counted). */
      error: "tooMany" | "tooLong" | "invisible" | "tooBig";
      line?: number;
    };

/**
 * One step per line: each line is normalized like a name (NFC, runs of whitespace as one space,
 * trimmed) and blank lines are left out. A line longer than 200 characters or holding a control
 * character (NUL among them) refuses the whole paste, naming the line: a step is never cut or
 * silently changed. More than 500 steps refuses it too.
 */
export function parseSyllabus(text: string): SyllabusResult {
  if (text.length > SYLLABUS_MAX_LENGTH) return { ok: false, error: "tooBig" };
  const titles: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (const [index, raw] of lines.entries()) {
    const title = normalizeName(raw);
    if (title === "") continue;
    if (hasInvisibleCharacters(title)) return { ok: false, error: "invisible", line: index + 1 };
    if (codePoints(title) > STEP_TITLE_MAX_LENGTH) {
      return { ok: false, error: "tooLong", line: index + 1 };
    }
    titles.push(title);
    if (titles.length > MAX_STEPS_PER_TRACK) return { ok: false, error: "tooMany" };
  }
  return { ok: true, titles };
}

/** A step as the syllabus reads it: in order, done or not. */
type StepLike = { id: string; doneAt: string | null };

/** The next step: the first one (in order) that isn't done, or null when every one is. */
export function nextStep<T extends StepLike>(steps: readonly T[]): T | null {
  return steps.find((step) => step.doneAt === null) ?? null;
}

/** Done of all: «13 de 40». */
export function stepCounts(steps: readonly StepLike[]): { done: number; total: number } {
  return {
    done: steps.filter((step) => step.doneAt !== null).length,
    total: steps.length,
  };
}
