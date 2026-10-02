// Due-date labels of tasks (SPEC-tasks "Estados": "Retrasada" is derived, a pending task whose
// due date is before Lima's day). Pure and client-safe: the instant is explicit, so nothing
// depends on the host's time zone.
import { formatDateKey } from "@/lib/time";
import { daysUntil } from "@/modules/projects/progress";

/** "Vence en N días" only up to a week ahead; further away, the date itself. */
export const TASK_DUE_SOON_DAYS = 7;

export type TaskDueState =
  | { kind: "overdue"; days: number; label: string }
  | { kind: "today"; days: 0; label: string }
  | { kind: "soon"; days: number; label: string }
  | { kind: "later"; days: number; label: string };

const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

/**
 * The due label of a pending task, by Lima's calendar day: "Retrasada hace N días", "Vence hoy",
 * "Vence mañana", "Vence en N días" (up to 7) or "Vence el 15 oct. 2026". Null without a due
 * date or when the task is done (a done task is never late).
 */
export function taskDueState(
  dueDate: string | null,
  doneAt: Date | null,
  now: Date,
): TaskDueState | null {
  if (dueDate === null || doneAt !== null) return null;
  const left = daysUntil(dueDate, now);
  if (left < 0) return { kind: "overdue", days: -left, label: `Retrasada hace ${days(-left)}` };
  if (left === 0) return { kind: "today", days: 0, label: "Vence hoy" };
  if (left === 1) return { kind: "soon", days: 1, label: "Vence mañana" };
  if (left <= TASK_DUE_SOON_DAYS) return { kind: "soon", days: left, label: `Vence en ${days(left)}` };
  return { kind: "later", days: left, label: `Vence el ${formatDateKey(dueDate, "short")}` };
}

/** Overdue and due today are the ones that call for attention (orange, with a LED). */
export const isUrgentDue = (due: TaskDueState | null) =>
  due !== null && (due.kind === "overdue" || due.kind === "today");
