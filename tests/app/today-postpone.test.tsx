// polish → postpone-one-tap on the board, against a fake server: what postponing does to "Día
// completo" (decision to review with the owner, pinned here), and a board left open past Lima's
// midnight (nothing is saved, the board is read again).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "@/modules/habits/habit-input";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import type { PostponedTask, RestoredDueDate } from "@/modules/tasks/task-postpone";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
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

/** Friday 2026-10-02, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

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

const pending: ((result: ActionResult<unknown>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}

type BoardProps = {
  habits?: HabitItem[];
  tasks?: TaskTodayItem[];
  doneToday?: number;
  today?: string;
};
function Board({ habits = [], tasks = [], doneToday = 0, today = TODAY }: BoardProps) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenos días
      </h1>
      <TodayBoard
        today={today}
        habits={habits}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
        dayComplete={{ tasksDoneToday: doneToday }}
      />
    </>
  );
}

const block = () => screen.queryByRole("region", { name: "Día completo" });
const tomorrowKey = (title: string) =>
  screen.getByRole("button", { name: `Pasar a mañana: ${title}` });
const notices = () => screen.getByRole("region", { name: "Avisos" });

const moved = (item: TaskTodayItem) =>
  ok<PostponedTask>({
    id: item.id,
    title: item.title,
    dueDate: "2026-10-03",
    previousDueDate: TODAY,
    changed: true,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  pending.length = 0;
  const wait = () =>
    new Promise<ActionResult<never>>((resolve) => {
      pending.push(resolve as (result: ActionResult<unknown>) => void);
    });
  vi.mocked(postponeTask).mockImplementation(wait);
  vi.mocked(restoreTaskDueDate).mockImplementation(wait);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("'Día completo' and postponing (decision to review with the owner)", () => {
  test("a day with no activity never becomes 'Día completo' by postponing its only task", async () => {
    const user = userEvent.setup();
    const one = task();
    render(<Board tasks={[one]} />);
    await user.click(tomorrowKey(one.title));
    await waitFor(() => expect(postponeTask).toHaveBeenCalledTimes(1));
    // Moving a task is not doing something: nothing was done today.
    expect(block()).toBeNull();
    await answer(moved(one));
    expect(block()).toBeNull();
  });

  test("with activity today (a habit done), postponing the last pending task shows 'Día completo'; Deshacer takes it away", async () => {
    const user = userEvent.setup();
    const one = task();
    const view = render(<Board habits={[habit({ quantity: 1 })]} tasks={[one]} />);
    // Positive control: with the task still pending the day is not complete.
    expect(block()).toBeNull();

    await user.click(tomorrowKey(one.title));
    await waitFor(() => expect(block()).not.toBeNull());
    // The completed count is the habit's: a postponed task is not counted as a done one.
    expect(document.querySelector("[data-today-complete-achieved]")).toHaveTextContent(
      "Logrado hoy: 1 hábito",
    );
    expect(document.querySelector("[data-today-complete-achieved]")).not.toHaveTextContent(/tarea/);
    await answer(moved(one));
    // The page's re-read has no tasks any more.
    view.rerender(<Board habits={[habit({ quantity: 1 })]} tasks={[]} />);

    await user.click(await within(notices()).findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(block()).toBeNull());
    expect(restoreTaskDueDate).toHaveBeenCalledWith({
      id: one.id,
      dueDate: TODAY,
      expected: "2026-10-03",
    });
    await answer(ok<RestoredDueDate>({ id: one.id, dueDate: TODAY, restored: true }));
  });

  test("with a task done earlier today, postponing the last pending one shows it with that one counted, not the postponed", async () => {
    const user = userEvent.setup();
    const one = task();
    render(<Board tasks={[one]} doneToday={1} />);
    await user.click(tomorrowKey(one.title));
    await waitFor(() => expect(block()).not.toBeNull());
    expect(document.querySelector("[data-today-complete-achieved]")).toHaveTextContent(
      "Logrado hoy: 1 tarea",
    );
    await answer(moved(one));
  });
});

describe("a board left open past Lima's midnight", () => {
  test("Mañana saves nothing and the board is read again (the list is of the day before)", async () => {
    const user = userEvent.setup();
    const one = task();
    render(<Board tasks={[one]} today="2026-10-01" />);
    await user.click(tomorrowKey(one.title));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(postponeTask).not.toHaveBeenCalled();
    // The row fades out and comes back: it was not moved.
    await waitFor(() => expect(tomorrowKey(one.title)).toBeInTheDocument());
  });
});
