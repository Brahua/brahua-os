// Composition root of the Telegram bot's capture (SPEC-reminders "Contratos → Con `core`"): the one
// place that knows `reminders` captures into `tasks` and `finance`. `reminders` defines the
// contract (`BotCapture`, in `@/modules/reminders/contracts`) and imports neither module; `tasks`
// and `finance` export plain data-layer functions and import nothing of `reminders`. The route of
// the webhook hands this object to the handler.
import "server-only";
import { formatShortDay, limaDayKey } from "@/lib/natural-date";
import { captureExpenseText, undoCapturedExpense } from "@/modules/finance/bot-capture";
import { formatMoney } from "@/modules/finance/money";
import { revalidateFinanceAndHome } from "@/modules/finance/revalidate";
import type { BotCapture } from "@/modules/reminders/contracts";
import { captureTaskText, undoCapturedTask } from "@/modules/tasks/bot-capture";
import { revalidateTaskLists } from "@/modules/tasks/revalidate";

export const botCapture: BotCapture = {
  async create(db, { kind, text, now }) {
    if (kind === "task") {
      const result = await captureTaskText(db, text, now);
      if (!result.ok) return result;
      const { task } = result;
      const day = task.dueDate ? formatShortDay(task.dueDate, limaDayKey(now)) : null;
      return {
        ok: true,
        kind: "task",
        entityId: task.id,
        title: task.title,
        dueLabel: day ? (task.dueTime ? `${day} · ${task.dueTime}` : day) : null,
      };
    }
    const result = await captureExpenseText(db, text, now);
    if (!result.ok) return result;
    const { expense } = result;
    return {
      ok: true,
      kind: "expense",
      entityId: expense.id,
      amountLabel: formatMoney(expense.amountCents, expense.currency),
      description: expense.description,
    };
  },

  undo(db, { kind, entityId }) {
    return kind === "task" ? undoCapturedTask(db, entityId) : undoCapturedExpense(db, entityId);
  },

  revalidate(kind) {
    if (kind === "task") revalidateTaskLists();
    else revalidateFinanceAndHome();
  },
};
