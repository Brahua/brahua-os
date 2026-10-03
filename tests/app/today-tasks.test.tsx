// D2 of `today`: "Tareas" on the board (SPEC-today "Pantalla"): 3 tasks shown and the rest
// behind "Ver N más", one tap completes with tasks' rule (the recurrence's notice), "Deshacer"
// and ⌘Z, the rollback of a refusal, and where focus goes when a row leaves. Against a fake
// server, inside the real board (its one notice viewport).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import type { TaskItem } from "@/modules/tasks/task-input";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayTasks } from "@/modules/today/components/today-tasks";
import { TODAY_HEADING_ID } from "@/modules/today/today-board";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
}));

/** Friday 2026-10-02, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

const TRABAJO = {
  id: "area-trabajo",
  slug: "trabajo",
  name: "Trabajo",
  icon: "briefcase",
  color: "blue",
};

let serial = 0;
function task(values: Partial<TaskTodayItem> = {}): TaskTodayItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Tarea ${serial}`,
    priority: "medium",
    dueDate: TODAY,
    due: { kind: "today", days: 0, label: "Vence hoy" },
    area: null,
    project: null,
    isNextAction: false,
    ...values,
  } as TaskTodayItem;
}

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<unknown>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}
const completed = (next: Partial<TaskItem> | null = null) =>
  ok({ task: {} as TaskItem, next, nextInbox: null });

function Board({ tasks, today = TODAY }: { tasks: TaskTodayItem[]; today?: string }) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenos días
      </h1>
      <TodayBoard
        today={today}
        habits={[]}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
      />
    </>
  );
}

const section = () => screen.getByRole("region", { name: "Tareas" });
const rows = () =>
  within(screen.getByRole("list", { name: "Tareas de hoy" })).getAllByRole("listitem");
const titles = () => rows().map((row) => within(row).getByRole("link").textContent);
const check = (title: string) => screen.getByRole("checkbox", { name: `Hecha: ${title}` });
const notices = () => screen.getByRole("region", { name: "Avisos" });
const count = () => document.querySelector("[data-today-tasks-count]");
const announcer = () => document.querySelector("[data-screen-announcer]");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  pending.length = 0;
  const wait = () =>
    new Promise<ActionResult<never>>((resolve) => {
      pending.push(resolve as (result: ActionResult<unknown>) => void);
    });
  vi.mocked(completeTaskWithNext).mockImplementation(wait);
  vi.mocked(reopenTaskWithSpawn).mockImplementation(wait);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what a row shows", () => {
  test("title linking to its page, area · project, the due label, Alta and the next action", () => {
    const one = task({
      title: "Enviar informe",
      priority: "high",
      due: { kind: "overdue", days: 2, label: "Retrasada hace 2 días" },
      area: TRABAJO as TaskTodayItem["area"],
      project: { id: "p1", name: "Lanzamiento" },
      isNextAction: true,
    });
    render(<Board tasks={[one]} />);

    const link = within(section()).getByRole("link", { name: "Enviar informe" });
    expect(link).toHaveAttribute("href", `/tasks/${one.id}`);
    expect(link).toHaveAccessibleDescription(
      "Trabajo · Lanzamiento, Retrasada hace 2 días, Prioridad alta, Próxima acción",
    );
    // The lists' color for overdue and today (orange with a LED), never red; no guilt.
    const due = section().querySelector("[data-task-due]");
    expect(due).toHaveTextContent("Retrasada hace 2 días");
    expect(due).toHaveClass("text-signal-text");
    expect(due?.className).not.toMatch(/danger|error|red/);
    expect(section().querySelector("[data-task-next-action]")).toHaveTextContent("Próxima acción");
    expect(section().textContent).not.toMatch(/fallaste|atrasad/i);
    expect(within(section()).getByRole("link", { name: "Ver tareas" })).toHaveAttribute(
      "href",
      "/tasks?vista=hoy",
    );
  });

  test("a task in the inbox: no area, and the title is described by its due label only", () => {
    render(<Board tasks={[task({ title: "Llamar" })]} />);
    expect(within(section()).getByRole("link", { name: "Llamar" })).toHaveAccessibleDescription(
      "Vence hoy",
    );
    expect(section().querySelector("[data-task-next-action]")).toBeNull();
  });

  test("the title says the total, read as “N para hoy”", () => {
    render(<Board tasks={[task(), task()]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Tareas" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(count()).toHaveTextContent("2 para hoy");
  });
});

describe("the fold: 3 shown, “Ver N más” / “Ver menos”", () => {
  test("with 3 or fewer there is no toggle", () => {
    render(<Board tasks={[task(), task(), task()]} />);
    expect(rows()).toHaveLength(3);
    expect(within(section()).queryByRole("button", { name: /^Ver/ })).toBeNull();
  });

  test("5 tasks: 3 shown and “Ver 2 más”; it expands and folds on this page", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task(), task(), task(), task()];
    render(<Board tasks={tasks} />);
    expect(titles()).toEqual(tasks.slice(0, 3).map((item) => item.title));
    expect(count()).toHaveTextContent("5");

    const more = within(section()).getByRole("button", { name: "Ver 2 más" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute(
      "aria-controls",
      screen.getByRole("list", { name: "Tareas de hoy" }).id,
    );
    await user.click(more);
    expect(titles()).toEqual(tasks.map((item) => item.title));
    const less = within(section()).getByRole("button", { name: "Ver menos" });
    // The same key: focus stays on it.
    expect(less).toHaveFocus();
    expect(less).toHaveAttribute("aria-expanded", "true");

    await user.click(less);
    expect(rows()).toHaveLength(3);
    expect(within(section()).getByRole("button", { name: "Ver 2 más" })).toHaveFocus();
  });
});

describe("completing", () => {
  test("one tap: the row leaves at once, the next folded one rises, focus to the next row", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task(), task(), task(), task()];
    const { rerender } = render(<Board tasks={tasks} />);

    await user.click(check(tasks[0].title));
    // Optimistic: gone before the server answers; the 4th rose into the fold.
    expect(titles()).toEqual([tasks[1].title, tasks[2].title, tasks[3].title]);
    expect(within(section()).getByRole("button", { name: "Ver 1 más" })).toBeInTheDocument();
    expect(count()).toHaveTextContent("4");
    expect(check(tasks[1].title)).toHaveFocus();
    expect(completeTaskWithNext).toHaveBeenCalledWith({ id: tasks[0].id });

    await answer(completed());
    // The action revalidated "/": the page comes back without it.
    rerender(<Board tasks={tasks.slice(1)} />);
    expect(
      await within(notices()).findByText(`«${tasks[0].title}» está hecha.`),
    ).toBeInTheDocument();
    expect(titles()).toEqual([tasks[1].title, tasks[2].title, tasks[3].title]);
    // One notice viewport on the board (the host's).
    expect(screen.getAllByRole("region", { name: "Avisos" })).toHaveLength(1);
  });

  test("a recurring task: the notice says when the next one is due (tasks' own notice)", async () => {
    const user = userEvent.setup();
    const one = task({ title: "Regar plantas" });
    render(<Board tasks={[one, task()]} />);
    await user.click(check("Regar plantas"));
    await answer(completed({ dueDate: "2026-10-05" }));
    expect(
      await within(notices()).findByText(
        "«Regar plantas» está hecha. La siguiente vence el 5 de octubre de 2026.",
      ),
    ).toBeInTheDocument();
  });

  test("the last row: focus goes to the previous one", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task(), task()];
    render(<Board tasks={tasks} />);
    await user.click(check(tasks[2].title));
    expect(check(tasks[1].title)).toHaveFocus();
    await answer(completed());
  });

  test("the only task: the section leaves and focus goes to the board's heading", async () => {
    const user = userEvent.setup();
    const one = task();
    render(<Board tasks={[one]} />);
    await user.click(check(one.title));
    expect(screen.queryByRole("region", { name: "Tareas" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    await answer(completed());
  });

  test("a refusal rolls the row back in its place and says so", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task()];
    render(<Board tasks={tasks} />);
    await user.click(check(tasks[0].title));
    expect(titles()).toEqual([tasks[1].title]);

    await answer(fail("Esta tarea ya no existe."));
    expect(await within(notices()).findByText(/No se pudo marcar la tarea/)).toBeInTheDocument();
    // The notice can render before useOptimistic rolls back: assert inside waitFor.
    await waitFor(() => expect(titles()).toEqual([tasks[0].title, tasks[1].title]));
  });

  test("a new Lima day with the board open: nothing is saved, the board is read again", async () => {
    const user = userEvent.setup();
    const one = task();
    render(<Board tasks={[one]} today="2026-10-01" />);
    await user.click(check(one.title));
    expect(completeTaskWithNext).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });
});

describe("Deshacer", () => {
  test("the notice's Deshacer puts it back in its place; aria-disabled while it saves", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task(), task()];
    const { rerender } = render(<Board tasks={tasks} />);
    await user.click(check(tasks[1].title));
    await answer(completed());
    rerender(<Board tasks={[tasks[0], tasks[2]]} />);

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(tasks.map((item) => item.title));
    const back = check(tasks[1].title);
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
    // A tap while it saves does nothing.
    await user.click(back);
    expect(completeTaskWithNext).toHaveBeenCalledTimes(1);
    expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: tasks[1].id });

    await answer(ok({ task: {} as TaskItem, spawn: "removed" }));
    rerender(<Board tasks={tasks} />);
    await waitFor(() => expect(check(tasks[1].title)).not.toHaveAttribute("aria-disabled"));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        `«${tasks[1].title}» volvió a estar pendiente y se quitó la siguiente.`,
      ),
    );
  });

  test("Ctrl+Z after completing undoes it, like the notice's Deshacer", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task()];
    const { rerender } = render(<Board tasks={tasks} />);
    await user.click(check(tasks[0].title));
    await answer(completed());
    rerender(<Board tasks={[tasks[1]]} />);
    expect(
      await within(notices()).findByText(`«${tasks[0].title}» está hecha.`),
    ).toBeInTheDocument();

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: tasks[0].id }));
    expect(titles()).toEqual(tasks.map((item) => item.title));
    await answer(ok({ task: {} as TaskItem, spawn: null }));
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(`«${tasks[0].title}» volvió a estar pendiente.`),
    );
  });

  test("an undo that fails takes the row out again and says so", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task()];
    const { rerender } = render(<Board tasks={tasks} />);
    await user.click(check(tasks[0].title));
    await answer(completed());
    rerender(<Board tasks={[tasks[1]]} />);
    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(tasks.map((item) => item.title));

    await answer(fail("Revisa tu conexión e inténtalo de nuevo."));
    expect(await within(notices()).findByText(/No se pudo deshacer/)).toBeInTheDocument();
    await waitFor(() => expect(titles()).toEqual([tasks[1].title]));
  });

  test("the last task, after the server's read came back empty: Deshacer puts it back at once", async () => {
    const user = userEvent.setup();
    const one = task({ title: "Pagar luz" });
    const { rerender } = render(<Board tasks={[one]} />);
    await user.click(check("Pagar luz"));
    await answer(completed());
    // The action revalidated "/": nothing left for today (count 0), the empty day shows.
    rerender(<Board tasks={[]} />);
    expect(screen.queryByRole("region", { name: "Tareas" })).toBeNull();
    expect(screen.getByRole("region", { name: "Nada programado para hoy" })).toBeInTheDocument();

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    // Before the reopen answers: the section is back with the row, saving.
    expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: one.id });
    expect(check("Pagar luz")).toHaveAttribute("aria-disabled", "true");
    expect(pending).toHaveLength(1);

    await answer(ok({ task: {} as TaskItem, spawn: null }));
    rerender(<Board tasks={[one]} />);
    await waitFor(() => expect(check("Pagar luz")).not.toHaveAttribute("aria-disabled"));
  });

  test("⌘Z (Meta) undoes it too", async () => {
    const user = userEvent.setup();
    const tasks = [task(), task()];
    const { rerender } = render(<Board tasks={tasks} />);
    await user.click(check(tasks[0].title));
    await answer(completed());
    rerender(<Board tasks={[tasks[1]]} />);
    expect(
      await within(notices()).findByText(`«${tasks[0].title}» está hecha.`),
    ).toBeInTheDocument();

    await user.keyboard("{Meta>}z{/Meta}");
    await waitFor(() => expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: tasks[0].id }));
    expect(titles()).toEqual(tasks.map((item) => item.title));
    await answer(ok({ task: {} as TaskItem, spawn: null }));
  });

  test("two completed in a row: Deshacer of the first puts back only the first", async () => {
    const user = userEvent.setup();
    const [a, b, c] = [task(), task(), task()];
    const { rerender } = render(<Board tasks={[a, b, c]} />);
    await user.click(check(a.title));
    await answer(completed());
    rerender(<Board tasks={[b, c]} />);
    expect(await within(notices()).findByText(`«${a.title}» está hecha.`)).toBeInTheDocument();
    // The second one, still saving, when the first's Deshacer is used.
    await user.click(check(b.title));
    expect(titles()).toEqual([c.title]);

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    // Only the first comes back, in its place; the second stays out.
    expect(titles()).toEqual([a.title, c.title]);
    await answer(completed()); // b's completion (queued first)
    await waitFor(() => expect(reopenTaskWithSpawn).toHaveBeenCalledWith({ id: a.id }));
    expect(reopenTaskWithSpawn).toHaveBeenCalledTimes(1);
    await answer(ok({ task: {} as TaskItem, spawn: null }));
    rerender(<Board tasks={[a, c]} />);
    await waitFor(() => expect(titles()).toEqual([a.title, c.title]));
  });
});

describe("focus when it was nowhere", () => {
  test("a tap that left focus on <body> (Safari) still moves it to the next row", async () => {
    const tasks = [task(), task()];
    render(<Board tasks={tasks} />);
    expect(document.activeElement).toBe(document.body);
    // A click without focusing the checkbox, as Safari does.
    fireEvent.click(check(tasks[0].title));
    await waitFor(() => expect(check(tasks[1].title)).toHaveFocus());
    await answer(completed());
  });

  test("focus elsewhere on the page stays there (positive control)", async () => {
    const tasks = [task(), task()];
    render(<Board tasks={tasks} />);
    const more = within(section()).getByRole("link", { name: "Ver tareas" });
    more.focus();
    fireEvent.click(check(tasks[0].title));
    await waitFor(() => expect(titles()).toEqual([tasks[1].title]));
    expect(more).toHaveFocus();
    await answer(completed());
  });
});
