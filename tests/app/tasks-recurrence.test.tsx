// T3: the recurrence editor (radio group, fields, live summary, by keyboard), its section in the
// detail (saves through setTaskRecurrence), the row's icon description, the quick capture's rule
// and the list's notices for a recurring task (the next one's date; what "Deshacer" did).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createTask, listTaskTargets } from "@/modules/tasks/actions";
import { TaskDetailProvider } from "@/modules/tasks/components/detail/task-detail-context";
import { TaskRecurrenceSection } from "@/modules/tasks/components/detail/task-recurrence-section";
import { QuickCaptureSheet } from "@/modules/tasks/components/quick-capture-sheet";
import { RecurrenceEditor } from "@/modules/tasks/components/recurrence-editor";
import { TaskList } from "@/modules/tasks/components/task-list";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  setTaskRecurrence,
} from "@/modules/tasks/recurrence-actions";
import { draftFromRule, type RecurrenceDraft } from "@/modules/tasks/recurrence-draft";
import type { TaskItem, TaskRecurrence, TaskTargets } from "@/modules/tasks/task-input";

vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  listTaskTargets: vi.fn(),
  editTask: vi.fn(),
  deleteTask: vi.fn(),
  restoreTask: vi.fn(),
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  setTaskRecurrence: vi.fn(),
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
  restoreTaskWithSpawn: vi.fn(),
}));

// 10:00 in Lima on Friday, Oct 2, 2026.
const NOW = new Date("2026-10-02T15:00:00.000Z");
const TARGETS: TaskTargets = { areas: [], projects: [] };
const EVERY_3_DAYS: TaskRecurrence = {
  kind: "every_days",
  interval: 3,
  weekdays: null,
  monthDay: null,
};

function task(values: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "regar las plantas",
    priority: "medium",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    createdAt: NOW,
    lifeAreaId: null,
    projectId: null,
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags: [],
    ...values,
  };
}

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(setTaskRecurrence).mockReset();
  vi.mocked(completeTaskWithNext).mockReset();
  vi.mocked(reopenTaskWithSpawn).mockReset();
  vi.mocked(createTask).mockReset();
  vi.mocked(listTaskTargets).mockReset().mockResolvedValue(ok(TARGETS));
});

function Editor({ initial = null }: { initial?: TaskRecurrence | null }) {
  const [draft, setDraft] = useState<RecurrenceDraft>(() => draftFromRule(initial, NOW));
  return <RecurrenceEditor id="r" draft={draft} onDraftChange={setDraft} now={NOW} />;
}

const summary = () => document.querySelector("[data-recurrence-summary]")!;
/** What screen readers hear (a polite status, after a change is made). */
const spoken = () => document.querySelector("[data-recurrence-status]")!;
const modes = () => screen.getByRole("group", { name: "Se repite" });

describe("RecurrenceEditor", () => {
  test("a radio group in a fieldset; by keyboard to every N days / weeks, with the summary", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const none = within(modes()).getByRole("radio", { name: "No se repite" });
    expect(none).toBeChecked();
    expect(summary()).toHaveTextContent("No se repite.");
    expect(spoken()).toHaveAttribute("role", "status");

    await user.tab();
    expect(none).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("radio", { name: "Cada cierto tiempo, desde que la completas" }),
    ).toBeChecked();
    expect(summary()).toHaveTextContent(
      "Cada día desde que la completas. Si la completas hoy, la siguiente vence el 3 de octubre de 2026.",
    );

    await user.tab();
    const interval = screen.getByRole("textbox", { name: "Cada" });
    expect(interval).toHaveFocus();
    await waitFor(() => expect(spoken()).toHaveTextContent("Cada día desde que la completas"));
    await user.keyboard("{Backspace}3");
    expect(summary()).toHaveTextContent("Cada 3 días desde que la completas");
    // Typing is seen at once, but heard only once the field is left (not on every keystroke).
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(spoken()).not.toHaveTextContent("Cada 3 días");
    await user.tab();
    await waitFor(() => expect(spoken()).toHaveTextContent("Cada 3 días desde que la completas"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Unidad" }), "semanas");
    expect(summary()).toHaveTextContent(
      "Cada 3 semanas desde que la completas. Si la completas hoy, la siguiente vence el 23 de octubre de 2026.",
    );
  });

  test("a wrong number shows its error once the field is left", async () => {
    const user = userEvent.setup();
    render(<Editor initial={EVERY_3_DAYS} />);
    const interval = screen.getByRole("textbox", { name: "Cada" });
    await user.clear(interval);
    await user.type(interval, "400");
    expect(interval).not.toHaveAccessibleDescription(/del 1 al 365/);
    await user.tab();
    expect(interval).toHaveAccessibleDescription("Escribe un número entero del 1 al 365.");
    expect(interval).toHaveAttribute("aria-invalid", "true");
  });

  test("weekdays: toggles named by day (today's on), the summary, and at least one", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole("radio", { name: "Ciertos días de la semana" }));
    const days = within(screen.getByRole("group", { name: "Días" }));
    expect(days.getAllByRole("button").map((key) => key.getAttribute("aria-label"))).toEqual([
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ]);
    // Visible: the first letters of each name, which start the accessible name (WCAG 2.5.3).
    expect(days.getAllByRole("button").map((key) => key.textContent)).toEqual([
      "Lu",
      "Ma",
      "Mi",
      "Ju",
      "Vi",
      "Sá",
      "Do",
    ]);
    // Friday in Lima.
    expect(days.getByRole("button", { name: "Viernes" })).toHaveAttribute("aria-pressed", "true");
    await user.click(days.getByRole("button", { name: "Lunes" }));
    expect(summary()).toHaveTextContent(
      "Los lunes y viernes. Si la completas hoy, la siguiente vence el 5 de octubre de 2026.",
    );
    // Keyboard: Space toggles.
    days.getByRole("button", { name: "Jueves" }).focus();
    await user.keyboard(" ");
    expect(summary()).toHaveTextContent("Los lunes, jueves y viernes");
    for (const name of ["Lunes", "Jueves", "Viernes"]) {
      await user.click(days.getByRole("button", { name }));
    }
    expect(screen.getByRole("group", { name: "Días" })).toHaveAccessibleDescription(
      "Elige al menos un día.",
    );
    // Said at once (an alert), and no summary while it can't be saved.
    expect(screen.getByRole("alert")).toHaveTextContent("Elige al menos un día.");
    expect(summary()).toHaveTextContent("");
  });

  test("weekdays and a day of the month start after the task's due date (completed early)", async () => {
    const user = userEvent.setup();
    function WithDue() {
      const [draft, setDraft] = useState<RecurrenceDraft>(() => draftFromRule(null, NOW));
      return (
        <RecurrenceEditor
          id="d"
          draft={draft}
          onDraftChange={setDraft}
          now={NOW}
          dueDate="2026-10-10"
        />
      );
    }
    render(<WithDue />);
    await user.click(screen.getByRole("radio", { name: "Ciertos días de la semana" }));
    // Friday the 2nd, due Saturday the 10th: the next Friday after it, the 16th.
    expect(summary()).toHaveTextContent("la siguiente vence el 16 de octubre de 2026.");
  });

  test("a day of the month (today's by default), clamped in words", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole("radio", { name: "Un día de cada mes" }));
    const day = screen.getByRole("textbox", { name: "Día del mes" });
    expect(day).toHaveValue("2");
    expect(day).toHaveAccessibleDescription("Si el mes es más corto, el último día.");
    await user.clear(day);
    await user.type(day, "31");
    expect(summary()).toHaveTextContent(
      "El último día de cada mes. Si la completas hoy, la siguiente vence el 31 de octubre de 2026.",
    );
  });
});

describe("the detail's Recurrencia section", () => {
  function renderSection(initial: TaskItem, host: "page" | "sheet" = "page") {
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailProvider task={initial} host={host} onDeleted={vi.fn()}>
          <TaskRecurrenceSection />
        </TaskDetailProvider>
      </TasksScreen>,
    );
  }

  test("a choice saves at once; a typed number when left; No se repite removes the rule", async () => {
    const user = userEvent.setup();
    const saved = (recurrence: TaskRecurrence | null) => ok(task({ recurrence }));
    vi.mocked(setTaskRecurrence).mockImplementation(async (input) =>
      saved((input as { recurrence: TaskRecurrence | null }).recurrence),
    );
    const id = task().id;
    renderSection(task());
    expect(screen.getByRole("heading", { level: 2, name: "Recurrencia" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Cada cierto tiempo/ }));
    expect(setTaskRecurrence).toHaveBeenLastCalledWith({
      id,
      recurrence: { kind: "every_days", interval: 1, weekdays: null, monthDay: null },
    });

    const interval = screen.getByRole("textbox", { name: "Cada" });
    await user.clear(interval);
    await user.type(interval, "3");
    expect(setTaskRecurrence).toHaveBeenCalledTimes(1);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(setTaskRecurrence).toHaveBeenCalledTimes(2));
    expect(setTaskRecurrence).toHaveBeenLastCalledWith({ id, recurrence: EVERY_3_DAYS });
    // Leaving it unchanged sends nothing more.
    await user.tab();
    expect(setTaskRecurrence).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("radio", { name: "No se repite" }));
    await waitFor(() =>
      expect(setTaskRecurrence).toHaveBeenLastCalledWith({ id, recurrence: null }),
    );
  });

  test("a refusal puts the saved rule back and says why (inside the sheet)", async () => {
    const user = userEvent.setup();
    let answer: (result: ActionResult<TaskItem>) => void = () => {};
    vi.mocked(setTaskRecurrence).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    renderSection(task({ recurrence: EVERY_3_DAYS }), "sheet");
    await user.click(screen.getByRole("radio", { name: "Un día de cada mes" }));
    expect(screen.getByRole("radio", { name: "Un día de cada mes" })).toBeChecked();
    await act(async () => answer(fail("Esta tarea ya no existe (se eliminó).")));
    expect(screen.getByRole("radio", { name: /Cada cierto tiempo/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Cada" })).toHaveValue("3");
  });
});

describe("the list", () => {
  function renderList(tasks: TaskItem[]) {
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <h2 id="view" tabIndex={-1}>
          Bandeja
        </h2>
        <TaskList
          tasks={tasks}
          label="Tareas en la bandeja"
          belongs={(item) => item.doneAt === null}
          fallbackFocusId="view"
          empty={<p>vacía</p>}
        />
      </TasksScreen>,
    );
  }
  const notices = () => screen.getByRole("region", { name: "Avisos" });
  const announcer = () => document.querySelector("[data-tasks-announcer]")!;

  test("the row's description says it repeats (the icon is decorative)", () => {
    renderList([task({ recurrence: EVERY_3_DAYS, priority: "high" })]);
    expect(screen.getByRole("link", { name: "regar las plantas" })).toHaveAccessibleDescription(
      "Prioridad alta, Se repite: cada 3 días desde que la completas",
    );
    // Sighted users get the summary as the icon's tooltip.
    expect(document.querySelector("[data-task-recurrence]")).toHaveAttribute(
      "title",
      "Cada 3 días desde que la completas",
    );
    expect(document.querySelector("[data-task-recurrence] svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("completing says when the next one is due; Deshacer says it was removed", async () => {
    const user = userEvent.setup();
    const original = task({ recurrence: EVERY_3_DAYS });
    const next = task({ id: "00000000-0000-4000-8000-000000000002", dueDate: "2026-10-05" });
    vi.mocked(completeTaskWithNext).mockResolvedValue(
      ok({ task: { ...original, doneAt: NOW }, next, nextInbox: null }),
    );
    vi.mocked(reopenTaskWithSpawn).mockResolvedValue(ok({ task: original, spawn: "removed" }));
    renderList([original]);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: regar las plantas" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "«regar las plantas» está hecha. La siguiente vence el 5 de octubre de 2026.",
      ),
    );
    await user.click(within(notices()).getByRole("button", { name: /Deshacer/ }));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "«regar las plantas» volvió a estar pendiente y se quitó la siguiente.",
      ),
    );
  });

  test("when its project is no longer open, the notice says the next one is in the inbox", async () => {
    const user = userEvent.setup();
    const original = task({ recurrence: EVERY_3_DAYS });
    const next = task({ id: "00000000-0000-4000-8000-000000000003", dueDate: "2026-10-05" });
    vi.mocked(completeTaskWithNext).mockResolvedValue(
      ok({ task: { ...original, doneAt: NOW }, next, nextInbox: "project" }),
    );
    renderList([original]);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: regar las plantas" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "La siguiente vence el 5 de octubre de 2026. La siguiente quedó en la bandeja porque el proyecto ya no está abierto.",
      ),
    );
  });

  test("Deshacer with an edited next one says it stayed", async () => {
    const user = userEvent.setup();
    const original = task({ recurrence: EVERY_3_DAYS });
    vi.mocked(completeTaskWithNext).mockResolvedValue(
      ok({ task: { ...original, doneAt: NOW }, next: null, nextInbox: null }),
    );
    vi.mocked(reopenTaskWithSpawn).mockResolvedValue(ok({ task: original, spawn: "kept" }));
    renderList([original]);
    await user.click(screen.getByRole("checkbox", { name: "Hecha: regar las plantas" }));
    await waitFor(() => expect(notices()).toHaveTextContent("«regar las plantas» está hecha."));
    await user.click(within(notices()).getByRole("button", { name: /Deshacer/ }));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "«regar las plantas» volvió a estar pendiente. La siguiente se quedó porque ya la cambiaste.",
      ),
    );
  });
});

describe("quick capture", () => {
  function renderSheet() {
    render(<QuickCaptureSheet open onOpenChange={vi.fn()} returnFocusRef={createRef()} />);
  }
  const titleField = () => screen.getByRole("textbox", { name: "¿Qué hay que hacer?" });

  test("Más detalles has the editor; the rule goes with the task", async () => {
    const user = userEvent.setup();
    vi.mocked(createTask).mockResolvedValue(ok(task({ recurrence: EVERY_3_DAYS })));
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    await user.click(screen.getByRole("radio", { name: /Cada cierto tiempo/ }));
    const interval = screen.getByRole("textbox", { name: "Cada" });
    await user.clear(interval);
    await user.type(interval, "3");
    await user.type(titleField(), "regar las plantas{Enter}");
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "regar las plantas", recurrence: EVERY_3_DAYS }),
      ),
    );
    // Back to no rule for the next one.
    await waitFor(() => expect(screen.getByRole("radio", { name: "No se repite" })).toBeChecked());
  });

  test("an unfinished rule opens Más detalles, shows why, and sends nothing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    await user.click(screen.getByRole("radio", { name: /Cada cierto tiempo/ }));
    await user.clear(screen.getByRole("textbox", { name: "Cada" }));
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    await user.type(titleField(), "regar{Enter}");
    expect(screen.getByRole("button", { name: "Más detalles" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const interval = screen.getByRole("textbox", { name: "Cada" });
    await waitFor(() => expect(interval).toHaveFocus());
    expect(interval).toHaveAccessibleDescription("Escribe un número entero del 1 al 365.");
    expect(createTask).not.toHaveBeenCalled();
  });
});
