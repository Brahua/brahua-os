// polish → task-time in the UI: the time field (a native time input and its "Quitar hora" key),
// the time on a row of the lists and of `today`'s board, and the detail (the field shows only
// with a day; it saves and clears through editTask; taking the day away takes the time with it).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok } from "@/lib/action-result";
import { editTask } from "@/modules/tasks/actions";
import { TaskDetailSheet } from "@/modules/tasks/components/detail/task-detail-sheet";
import { TaskRow } from "@/modules/tasks/components/task-row";
import { TaskTodayRow } from "@/modules/tasks/components/task-today-row";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import { TimeField } from "@/modules/tasks/components/time-field";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/modules/tasks/detail-actions", () => ({
  readTaskNotes: vi.fn(async () => ({ ok: true, data: { notes: null } })),
  updateTaskNotes: vi.fn(),
  listTaskMilestones: vi.fn(),
  setTaskMilestone: vi.fn(),
}));
vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  listTaskTargets: vi.fn(),
  editTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
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

function task(values: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "ir al dentista",
    priority: "medium",
    dueDate: "2026-10-02",
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
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(editTask).mockReset();
});

describe("TimeField", () => {
  test("shows the value, reports a typed time, and 'Quitar hora' clears it and returns focus to the input", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeField id="t" label="Hora" value="09:30" onChange={onChange} help="Opcional." />,
    );
    const input = screen.getByLabelText("Hora");
    expect(input).toHaveValue("09:30");
    expect(input).toHaveAttribute("type", "time");
    expect(input).toHaveAccessibleDescription("Opcional.");

    fireEvent.change(input, { target: { value: "14:45" } });
    expect(onChange).toHaveBeenLastCalledWith("14:45");

    await user.click(screen.getByRole("button", { name: "Quitar hora" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveFocus();

    // Empty: the key stays mounted (a key never unmounts under focus) but does nothing.
    onChange.mockClear();
    rerender(<TimeField id="t" label="Hora" value="" onChange={onChange} help="Opcional." />);
    const clear = screen.getByRole("button", { name: "Quitar hora" });
    expect(clear).toHaveAttribute("aria-disabled", "true");
    await user.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an error replaces the help and marks the input", () => {
    render(
      <TimeField id="t" label="Hora" value="" onChange={vi.fn()} error="Mala hora" help="x" />,
    );
    const input = screen.getByLabelText("Hora");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Mala hora");
  });
});

describe("rows", () => {
  function renderRow(item: TaskItem) {
    return render(
      <ul>
        <li>
          <TaskRow task={item} now={NOW} onToggle={vi.fn()} onOpen={vi.fn()} />
        </li>
      </ul>,
    );
  }

  test("a task with a time shows it (24 h, tabular mono) and says it in words", () => {
    renderRow(task({ dueTime: "10:00" }));
    const shown = document.querySelector("[data-task-time]")!;
    expect(shown).toHaveTextContent("10:00");
    expect(shown).toHaveClass("font-mono", "tabular-nums");
    expect(shown.closest("[aria-hidden]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "ir al dentista" })).toHaveAccessibleDescription(
      "Vence hoy, a las 10:00",
    );
  });

  test("without a time, and a done task, show none", () => {
    const { unmount } = renderRow(task());
    expect(document.querySelector("[data-task-time]")).toBeNull();
    unmount();
    renderRow(task({ dueTime: "10:00", doneAt: new Date("2026-10-02T14:00:00Z") }));
    expect(document.querySelector("[data-task-time]")).toBeNull();
  });

  test("a row of today's board shows the time too", () => {
    const item: TaskTodayItem = {
      id: "00000000-0000-4000-8000-000000000009",
      title: "llamar al banco",
      priority: "medium",
      dueDate: "2026-10-02",
      dueTime: "16:30",
      due: { kind: "today", days: 0, label: "Vence hoy" },
      area: null,
      project: null,
      isNextAction: false,
    };
    const { unmount } = render(
      <ul>
        <li>
          <TaskTodayRow task={item} onComplete={vi.fn()} />
        </li>
      </ul>,
    );
    expect(document.querySelector("[data-task-time]")).toHaveTextContent("16:30");
    expect(screen.getByRole("link", { name: "llamar al banco" })).toHaveAccessibleDescription(
      "Vence hoy, a las 16:30",
    );
    unmount();
    render(
      <ul>
        <li>
          <TaskTodayRow task={{ ...item, dueTime: null }} onComplete={vi.fn()} />
        </li>
      </ul>,
    );
    expect(document.querySelector("[data-task-time]")).toBeNull();
  });
});

describe("detail", () => {
  function renderSheet(item: TaskItem) {
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <TaskDetailSheet
          open
          onOpenChange={() => {}}
          task={item}
          returnFocusRef={{ current: null }}
          onDeleted={() => {}}
        />
      </TasksScreen>,
    );
    return screen.findByRole("dialog", { name: item.title });
  }

  test("without a day there is no time field (positive control: with a day there is)", async () => {
    const dialog = await renderSheet(task({ dueDate: null }));
    expect(within(dialog).queryByLabelText("Hora")).toBeNull();
    expect(within(dialog).getByLabelText("Fecha límite")).toBeInTheDocument();
  });

  test("saves a time, then clears it with 'Quitar hora'", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    vi.mocked(editTask)
      .mockResolvedValueOnce(ok(task({ dueTime: "14:30" })))
      .mockResolvedValueOnce(ok(task({ dueTime: null })));
    const dialog = await renderSheet(task());
    const field = within(dialog).getByLabelText("Hora");
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: "14:30" } });
    await waitFor(() =>
      expect(editTask).toHaveBeenLastCalledWith({ id: task().id, dueTime: "14:30" }),
    );
    await waitFor(() => expect(within(dialog).getByLabelText("Hora")).toHaveValue("14:30"));

    await user.click(within(dialog).getByRole("button", { name: "Quitar hora" }));
    await waitFor(() =>
      expect(editTask).toHaveBeenLastCalledWith({ id: task().id, dueTime: null }),
    );
    await waitFor(() => expect(within(dialog).getByLabelText("Hora")).toHaveValue(""));
    expect(within(dialog).getByLabelText("Hora")).toHaveFocus();
  });

  test("taking the day away takes the time field with it (and the server clears the time)", async () => {
    vi.mocked(editTask).mockResolvedValueOnce(ok(task({ dueDate: null, dueTime: null })));
    const dialog = await renderSheet(task({ dueTime: "08:00" }));
    expect(within(dialog).getByLabelText("Hora")).toHaveValue("08:00");
    fireEvent.change(within(dialog).getByLabelText("Fecha límite"), { target: { value: "" } });
    await waitFor(() =>
      expect(editTask).toHaveBeenLastCalledWith({ id: task().id, dueDate: null }),
    );
    await waitFor(() => expect(within(dialog).queryByLabelText("Hora")).toBeNull());
  });
});
