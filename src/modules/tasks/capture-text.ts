// What the quick capture understands from a task's title (polish → capture-nl-dates): the pure
// parser of `src/lib/natural-date.ts` plus the preview's words. Client-safe, no clock of its own.
import { formatShortDay, limaDayKey, parseTaskText, type TaskTextResult } from "@/lib/natural-date";
import { TASKS_COPY } from "./tasks-copy";

export type CaptureReading = TaskTextResult & {
  /** "Vence el vie 10 oct · 10:00", or "Hora 10:00" when the day was picked by hand. */
  summary: string;
};

/**
 * The reading of `text` at `now`, or null when nothing was understood. A day picked by hand
 * (`manualDate`, YYYY-MM-DD, "" for none) rules: the date words stay in the title and only an
 * hour is read, to go with that day (decisión autónoma para revisar con el owner).
 */
export function readCaptureTitle(
  text: string,
  now: Date,
  manualDate: string,
): CaptureReading | null {
  const result = parseTaskText(text, now, { skipDate: manualDate !== "" });
  if (result.interpreted.length === 0) return null;
  const summary = result.dueDate
    ? TASKS_COPY.nlDue(formatShortDay(result.dueDate, limaDayKey(now)), result.dueTime)
    : result.dueTime
      ? TASKS_COPY.nlTimeOnly(result.dueTime)
      : null;
  return summary ? { ...result, summary } : null;
}
