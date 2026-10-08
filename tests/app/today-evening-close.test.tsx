// polish → evening-close-ritual on the board, against a fake server: the close of the day from
// 20:00 (Lima) when something is left, "Mañana" for every pending task with one notice and one
// "Deshacer", "Dejar aquí", and the board waiting for the hour.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "@/modules/habits/habit-input";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import type { PostponedTask, RestoredDueDate } from "@/modules/tasks/task-postpone";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import { EveningCloseWatch } from "@/modules/today/components/evening-close";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayTasks } from "@/modules/today/components/today-tasks";
import { TODAY_HEADING_ID } from "@/modules/today/today-board";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  logHabit: vi.fn(),
  setHabitQuantity: vi.fn(),
}));
vi.mock("@/modules/tasks/postpone-actions", () => ({
  postponeTask: vi.fn(),
  restoreTaskDueDate: vi.fn(),
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
}));

/** Friday 2026-10-02, 21:00 in Lima (02:00 UTC the next day). Only Date is faked. */
const NIGHT = new Date("2026-10-03T02:00:00.000Z");
const TODAY = ownerDateKey(NIGHT);
const TOMORROW = "2026-10-03";

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

let serial = 0;
function habit(values: Partial<HabitItem> = {}): HabitItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Hábito ${serial}`,
    kind: "build",
    measure: "check",
    goal: 1,
    unit: null,
    step: 1,
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-01-01",
    area: null,
    quantity: 0,
    target: 1,
    hasLogs: false,
    weekDoneBefore: 0,
    weekAvailable: 7,
    streak: { unit: "days", done: 0, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
    ...values,
  };
}

function task(title: string): TaskTodayItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title,
    priority: "medium",
    dueDate: TODAY,
    due: { kind: "today", days: 0, label: "Vence hoy" },
    area: null,
    project: null,
    isNextAction: false,
  } as TaskTodayItem;
}

type BoardProps = {
  habits?: HabitItem[];
  tasks?: TaskTodayItem[];
  doneToday?: number;
  closing?: boolean;
};
function Board({ habits = [], tasks = [], doneToday = 0, closing = true }: BoardProps) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenas noches
      </h1>
      <TodayBoard
        closing={closing}
        today={TODAY}
        habits={habits}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
        dayComplete={{ tasksDoneToday: doneToday }}
      />
    </>
  );
}

const close = () => document.querySelector("[data-evening-close]");
const question = () => document.querySelector("[data-evening-question]");
const notices = () => screen.getByRole("region", { name: "Avisos" });
const rows = () => document.querySelectorAll("[data-task-row]");

/**
 * The fake server answers when the test opens the gate (until then the save is "in flight", so
 * the optimistic rows are what the screen shows, as with a real network).
 */
let gate: { promise: Promise<void>; open: () => void };
function newGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { promise, open };
}

/** What the fake server answers: every task moves to tomorrow, unless it is told to fail. */
const failing = new Set<string>();
const items = new Map<string, TaskTodayItem>();
function serve(list: TaskTodayItem[]) {
  for (const item of list) items.set(item.id, item);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NIGHT);
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  failing.clear();
  items.clear();
  newGate();
  vi.mocked(postponeTask).mockImplementation(async (input) => {
    const { id } = input as { id: string };
    await gate.promise;
    if (failing.has(id)) return fail("Sin conexión con el servidor.");
    const item = items.get(id)!;
    return ok<PostponedTask>({
      id,
      title: item.title,
      dueDate: TOMORROW,
      previousDueDate: TODAY,
      changed: true,
    }) as ActionResult<PostponedTask>;
  });
  vi.mocked(restoreTaskDueDate).mockImplementation(async (input) => {
    const { id } = input as { id: string };
    await gate.promise;
    return ok<RestoredDueDate>({ id, dueDate: TODAY, restored: true });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the close of the day", () => {
  test("says what was achieved, the habits as 'X de N' and one question about the tasks", () => {
    const tasks = [task("Pagar luz"), task("Llamar a mamá")];
    render(<Board habits={[habit({ quantity: 1 }), habit()]} tasks={tasks} doneToday={3} />);
    const section = close() as HTMLElement;
    expect(within(section).getByRole("heading", { name: "Cierre del día" })).toBeInTheDocument();
    // The spoken line has the numbers whole; the visual one rolls (NumberFlow).
    expect(section.querySelector("[data-evening-achieved] .sr-only")).toHaveTextContent(
      "Hoy: 1 hábito y 3 tareas.",
    );
    expect(section.querySelector("[data-evening-habits]")).toHaveTextContent("Hábitos: 1 de 2");
    expect(question()).toHaveTextContent(/2 tareas/);
    expect(within(section).getByRole("button", { name: "Mañana" })).toBeVisible();
    expect(within(section).getByRole("button", { name: "Dejar aquí" })).toBeVisible();
    // The keys are described by the question.
    expect(within(section).getByRole("group")).toHaveAccessibleName(/2 tareas/);
  });

  test("a single task is said in the singular", () => {
    render(<Board habits={[habit({ quantity: 1 })]} tasks={[task("Pagar luz")]} />);
    expect(question()?.textContent).toMatch(/1 tarea|Una tarea|esa tarea/);
    expect(question()?.textContent).not.toMatch(/tareas/);
  });

  test("not before the hour: nothing of the close (the board only waits for it)", () => {
    render(<Board closing={false} habits={[habit({ quantity: 1 })]} tasks={[task("Pagar luz")]} />);
    expect(close()).toBeNull();
  });

  test("a finished day is 'Día completo', not the close", () => {
    render(<Board habits={[habit({ quantity: 1 })]} tasks={[]} doneToday={2} />);
    expect(close()).toBeNull();
    expect(screen.getByRole("region", { name: "Día completo" })).toBeInTheDocument();
  });

  test("nothing done and nothing to move: it has nothing to say", () => {
    render(<Board habits={[habit()]} tasks={[]} />);
    expect(close()).toBeNull();
  });

  test("only habits left (some done): the achieved line and 'X de N', no question", () => {
    render(<Board habits={[habit({ quantity: 1 }), habit()]} tasks={[]} />);
    expect(close()).not.toBeNull();
    expect(document.querySelector("[data-evening-habits]")).toHaveTextContent("Hábitos: 1 de 2");
    expect(question()).toBeNull();
    expect(screen.queryByRole("button", { name: "Mañana" })).toBeNull();
  });
});

describe("'Mañana': every pending task, one notice, one 'Deshacer'", () => {
  test("moves them all, says it once, and 'Deshacer' brings them all back", async () => {
    const user = userEvent.setup();
    const tasks = [task("Pagar luz"), task("Llamar a mamá")];
    serve(tasks);
    const habits = [habit({ quantity: 1 })];
    const view = render(<Board habits={habits} tasks={tasks} />);
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Mañana" }));
    // While the saves are in flight the rows and the question have already left.
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(question()).toBeNull();
    await waitFor(() => expect(postponeTask).toHaveBeenCalled());
    await act(async () => gate.open());
    await waitFor(() => expect(postponeTask).toHaveBeenCalledTimes(2));
    expect(postponeTask).toHaveBeenCalledWith({ id: tasks[0].id, to: "tomorrow" });
    expect(postponeTask).toHaveBeenCalledWith({ id: tasks[1].id, to: "tomorrow" });

    // One notice for both, not one per task.
    expect(await within(notices()).findByText("2 tareas pasan a mañana.")).toBeVisible();
    expect(within(notices()).getAllByRole("button", { name: "Deshacer" })).toHaveLength(1);
    // Focus did not fall to the body.
    expect(document.body).not.toHaveFocus();
    // The page's re-read has no tasks any more.
    view.rerender(<Board habits={habits} tasks={[]} />);
    expect(rows()).toHaveLength(0);

    newGate();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    // Back at once, in their places, and the question with them.
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(question()).not.toBeNull();
    await act(async () => gate.open());
    await waitFor(() => expect(restoreTaskDueDate).toHaveBeenCalledTimes(2));
    expect(restoreTaskDueDate).toHaveBeenCalledWith({
      id: tasks[0].id,
      dueDate: TODAY,
      expected: TOMORROW,
    });
  });

  test("with activity today, moving the last tasks shows 'Día completo' (a postponed task is not a done one)", async () => {
    const user = userEvent.setup();
    const tasks = [task("Pagar luz")];
    serve(tasks);
    render(<Board habits={[habit({ quantity: 1 })]} tasks={tasks} />);
    // Positive control: with the task pending the day is not complete.
    expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mañana" }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Día completo" })).toBeInTheDocument(),
    );
    expect(close()).toBeNull();
    expect(document.querySelector("[data-today-complete-achieved]")).not.toHaveTextContent(/tarea/);
    await act(async () => gate.open());
  });

  test("one task fails: the same notice says so, and its 'Deshacer' still brings back the other", async () => {
    const user = userEvent.setup();
    const tasks = [task("Pagar luz"), task("Llamar a mamá")];
    serve(tasks);
    failing.add(tasks[1].id);
    render(<Board habits={[habit({ quantity: 1 })]} tasks={tasks} />);
    await user.click(screen.getByRole("button", { name: "Mañana" }));
    await act(async () => gate.open());
    expect(
      await within(notices()).findByText("«Pagar luz» pasa a mañana. Una no se pudo mover."),
    ).toBeVisible();
    expect(within(notices()).getAllByRole("button", { name: "Deshacer" })).toHaveLength(1);
    // The failed one is not moved: its row is back (the server still has it today).
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  test("every task fails: only 'Sin guardar', no 'Deshacer', and the rows come back", async () => {
    const user = userEvent.setup();
    const tasks = [task("Pagar luz"), task("Llamar a mamá")];
    serve(tasks);
    for (const item of tasks) failing.add(item.id);
    render(<Board habits={[habit({ quantity: 1 })]} tasks={tasks} />);
    await user.click(screen.getByRole("button", { name: "Mañana" }));
    await act(async () => gate.open());
    expect(
      await within(notices()).findByText(
        /No se pudieron mover 2 tareas; volvieron a como estaban\./,
      ),
    ).toBeVisible();
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).toBeNull();
    await waitFor(() => expect(rows()).toHaveLength(2));
  });
});

describe("'Dejar aquí'", () => {
  test("the question goes away, nothing is moved and the tasks stay in Hoy", async () => {
    const user = userEvent.setup();
    const tasks = [task("Pagar luz"), task("Llamar a mamá")];
    serve(tasks);
    render(<Board habits={[habit({ quantity: 1 })]} tasks={tasks} />);
    await user.click(screen.getByRole("button", { name: "Dejar aquí" }));
    expect(question()).toBeNull();
    expect(postponeTask).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    // What was achieved stays; focus went to the close's heading, not the body.
    expect(close()).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Cierre del día" })).toHaveFocus();
  });
});

describe("the board waiting for 20:00", () => {
  test("it reads the page again once, when the hour comes", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    // 19:59:30 in Lima: 30 s (+ the 1 s margin) to go.
    vi.setSystemTime(new Date("2026-10-03T00:59:30.000Z"));
    render(<EveningCloseWatch />);
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test("the timer is cleared when the board leaves", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-03T00:59:30.000Z"));
    const view = render(<EveningCloseWatch />);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
