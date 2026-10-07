// polish → postpone-one-tap: "Mañana" and "Otro día…" on the rows of "/" (`today`'s "Tareas") and of
// the Hoy view of /tasks, against a fake server: the key, the sheet, the optimistic row and its
// notice, "Deshacer" (by task id, the exact day it had), the rollback of a refusal, where focus
// goes when the row leaves, and the swipe's reduced-motion and desktop rules.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { TodayView } from "@/app/(app)/tasks/_components/date-views";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import { TasksScreen } from "@/modules/tasks/components/tasks-screen";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import type { PostponedTask, RestoredDueDate } from "@/modules/tasks/task-postpone";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayTasks } from "@/modules/today/components/today-tasks";
import { TODAY_HEADING_ID } from "@/modules/today/today-board";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
// motion reads the preference once for the whole page; the test needs both answers.
let reduced = false;
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reduced,
}));
vi.mock("@/modules/tasks/postpone-actions", () => ({
  postponeTask: vi.fn(),
  restoreTaskDueDate: vi.fn(),
}));
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
  restoreTaskWithSpawn: vi.fn(),
}));
vi.mock("@/modules/tasks/actions", () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  editTask: vi.fn(),
  listTaskTargets: vi.fn(),
}));

/** Friday 2026-10-02, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);
const TOMORROW = "2026-10-03";

beforeAll(() => {
  // The fade (90 ms) and the swipe's springs end at once; the rules are what is tested here.
  MotionGlobalConfig.skipAnimations = true;
});

let desktop = false;
beforeEach(() => {
  desktop = false;
  reduced = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
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

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<unknown>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}

const moved = (task: { id: string; title: string }, values: Partial<PostponedTask> = {}) =>
  ok<PostponedTask>({
    id: task.id,
    title: task.title,
    dueDate: TOMORROW,
    previousDueDate: TODAY,
    changed: true,
    ...values,
  });
const restored = (task: { id: string }, dueDate: string | null = TODAY, did = true) =>
  ok<RestoredDueDate>({ id: task.id, dueDate, restored: did });

let serial = 0;
function todayItem(values: Partial<TaskTodayItem> = {}): TaskTodayItem {
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

function Board({ tasks }: { tasks: TaskTodayItem[] }) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenos días
      </h1>
      <TodayBoard
        today={TODAY}
        habits={[]}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
      />
    </>
  );
}

const section = () => screen.getByRole("region", { name: "Tareas" });
const titles = () =>
  within(screen.getByRole("list", { name: "Tareas de hoy" }))
    .getAllByRole("listitem")
    .map((row) => within(row).getByRole("link").textContent);
const tomorrowKey = (title: string) =>
  screen.getByRole("button", { name: `Pasar a mañana: ${title}` });
const pickKey = (title: string) =>
  screen.getByRole("button", { name: `Elegir otro día para ${title}` });
const notices = () => screen.getByRole("region", { name: "Avisos" });

describe("'/' (today's Tareas)", () => {
  test("each row has 'Mañana' (icon and text, secondary) and 'Otro día…'", () => {
    const [first] = [todayItem({ title: "Enviar informe" })];
    render(<Board tasks={[first]} />);
    const key = tomorrowKey("Enviar informe");
    expect(key).toHaveTextContent("Mañana");
    expect(key.querySelector("svg")).not.toBeNull();
    // Secondary: completing stays the row's one primary action (never the signal key).
    expect(key.className).not.toMatch(/signal/);
    expect(pickKey("Enviar informe")).toHaveTextContent("Otro día…");
  });

  test("one tap: the row leaves, the server moves it to 'tomorrow', the notice offers Deshacer", async () => {
    const user = userEvent.setup();
    const [a, b, c] = [todayItem(), todayItem(), todayItem()];
    render(<Board tasks={[a, b, c]} />);

    await user.click(tomorrowKey(a.title));
    await waitFor(() => expect(titles()).toEqual([b.title, c.title]));
    expect(postponeTask).toHaveBeenCalledExactlyOnceWith({ id: a.id, to: "tomorrow" });
    // Focus goes to the same key of the next row, never <body>.
    expect(tomorrowKey(b.title)).toHaveFocus();

    await answer(moved(a));
    expect(within(notices()).getByText(`«${a.title}» pasa a mañana.`)).toBeInTheDocument();
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  test("Deshacer puts it back in its place and restores exactly the day it had, by id", async () => {
    const user = userEvent.setup();
    const overdue = todayItem({
      dueDate: "2026-09-30",
      due: { kind: "overdue", days: 2, label: "Retrasada hace 2 días" },
    });
    const other = todayItem();
    render(<Board tasks={[overdue, other]} />);

    await user.click(tomorrowKey(overdue.title));
    await waitFor(() => expect(titles()).toEqual([other.title]));
    await answer(moved(overdue, { previousDueDate: "2026-09-30" }));

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual([overdue.title, other.title]);
    expect(restoreTaskDueDate).toHaveBeenCalledExactlyOnceWith({
      id: overdue.id,
      dueDate: "2026-09-30",
      expected: TOMORROW,
    });
    // The undo is saving: its keys stay focusable but do nothing (aria-disabled, never disabled).
    expect(tomorrowKey(overdue.title)).toHaveAttribute("aria-disabled", "true");
    expect(tomorrowKey(overdue.title)).not.toBeDisabled();
    await answer(restored(overdue, "2026-09-30"));
  });

  test("a refusal rolls the row back in its place and says so", async () => {
    const user = userEvent.setup();
    const [a, b] = [todayItem(), todayItem()];
    render(<Board tasks={[a, b]} />);

    await user.click(tomorrowKey(a.title));
    await waitFor(() => expect(titles()).toEqual([b.title]));
    await answer(fail("Esta tarea ya no existe (se eliminó)."));

    expect(titles()).toEqual([a.title, b.title]);
    const notice = within(notices());
    expect(notice.getByText("Sin guardar")).toBeInTheDocument();
    expect(
      notice.getByText(/No se pudo mover la tarea; volvió a como estaba\./),
    ).toBeInTheDocument();
    expect(notice.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  test("a double tap moves it once; an 'unchanged' answer says nothing", async () => {
    const user = userEvent.setup();
    const [a, b] = [todayItem(), todayItem()];
    render(<Board tasks={[a, b]} />);

    await user.dblClick(tomorrowKey(a.title));
    await waitFor(() => expect(titles()).toEqual([b.title]));
    expect(postponeTask).toHaveBeenCalledTimes(1);
    await answer(moved(a, { previousDueDate: TOMORROW, changed: false }));
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  test("an undo of a day edited meanwhile changes nothing and says so", async () => {
    const user = userEvent.setup();
    const [a, b] = [todayItem(), todayItem()];
    const view = render(<Board tasks={[a, b]} />);
    await user.click(tomorrowKey(a.title));
    await waitFor(() => expect(titles()).toEqual([b.title]));
    await answer(moved(a));
    // The page's re-read: it no longer has the task.
    view.rerender(<Board tasks={[b]} />);

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await answer(restored(a, "2026-10-09", false));
    // The optimistic row rolls back (the newer day stays) and the notice says why.
    await waitFor(() => expect(titles()).toEqual([b.title]));
    expect(within(notices()).getByText(/La fecha ya cambió/)).toBeInTheDocument();
  });

  test("'Otro día…' opens a sheet from tomorrow on; 'Mover' sends the day and the row leaves", async () => {
    const user = userEvent.setup();
    const [a, b] = [todayItem(), todayItem()];
    render(<Board tasks={[a, b]} />);

    await user.click(pickKey(a.title));
    const sheet = await screen.findByRole("dialog", { name: "Otro día" });
    const day = within(sheet).getByLabelText("Día");
    expect(day).toHaveAttribute("min", TOMORROW);
    expect(day).toHaveValue(TOMORROW);

    await user.clear(day);
    await user.type(day, "2026-10-09");
    await user.click(within(sheet).getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(titles()).toEqual([b.title]));
    expect(postponeTask).toHaveBeenCalledExactlyOnceWith({ id: a.id, to: "2026-10-09" });
    await answer(moved(a, { dueDate: "2026-10-09" }));
    expect(within(notices()).getByText(`«${a.title}» pasa al 9 oct. 2026.`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus did not stay on the gone row's key.
    expect(document.body).not.toHaveFocus();
  });

  test("'Otro día…' refuses a day before the minimum without calling the server", async () => {
    const user = userEvent.setup();
    const [a] = [todayItem()];
    render(<Board tasks={[a, todayItem()]} />);
    await user.click(pickKey(a.title));
    const sheet = await screen.findByRole("dialog", { name: "Otro día" });
    const day = within(sheet).getByLabelText("Día");
    await user.clear(day);
    await user.type(day, "2026-10-01");
    await user.click(within(sheet).getByRole("button", { name: "Mover" }));
    expect(within(sheet).getByText("Elige hoy o un día que venga.")).toBeInTheDocument();
    expect(postponeTask).not.toHaveBeenCalled();
  });

  test("the last row: the section leaves and focus goes to the board's heading", async () => {
    const user = userEvent.setup();
    const [a] = [todayItem()];
    render(<Board tasks={[a]} />);
    await user.click(tomorrowKey(a.title));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Tareas" })).toBeNull());
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    await answer(moved(a));
  });
});

describe("the swipe", () => {
  test("on a touch screen the row has the 'Mañana' hint behind it; reduced motion leaves only the key", () => {
    const { unmount } = render(<Board tasks={[todayItem()]} />);
    expect(section().querySelector("[data-swipe-hint]")).not.toBeNull();
    unmount();

    reduced = true;
    render(<Board tasks={[todayItem()]} />);
    expect(section().querySelector("[data-swipe-hint]")).toBeNull();
    // The key is still there: it is the accessible alternative.
    expect(within(section()).getAllByRole("button", { name: /^Pasar a mañana/ })).toHaveLength(1);
  });

  test("from 1024 px there is no swipe", () => {
    desktop = true;
    render(<Board tasks={[todayItem()]} />);
    expect(section().querySelector("[data-swipe-hint]")).toBeNull();
  });
});

// ── /tasks, the "Hoy" view ──

const TARGETS: TaskTargets = { areas: [], projects: [] };

let taskSerial = 0;
function listTask(values: Partial<TaskItem> = {}): TaskItem {
  taskSerial += 1;
  return {
    id: `10000000-0000-4000-8000-${String(taskSerial).padStart(12, "0")}`,
    title: `Pendiente ${taskSerial}`,
    priority: "medium",
    dueDate: TODAY,
    doneAt: null,
    createdAt: new Date("2026-09-20T12:00:00Z"),
    lifeAreaId: null,
    projectId: null,
    milestoneId: null,
    isNextAction: false,
    area: null,
    project: null,
    recurrence: null,
    tags: [],
    ...values,
  } as TaskItem;
}

function TasksToday({ tasks }: { tasks: TaskItem[] }) {
  return (
    <TasksScreen now={NOW} targets={TARGETS}>
      <h2 id="heading" tabIndex={-1}>
        Hoy
      </h2>
      <TodayView tasks={tasks} headingId="heading" />
    </TasksScreen>
  );
}

describe("/tasks (Hoy)", () => {
  test("'Mañana' takes the row out of Hoy, offers Deshacer and brings it back on the same day", async () => {
    const user = userEvent.setup();
    const [a, b] = [listTask(), listTask()];
    render(<TasksToday tasks={[a, b]} />);
    const list = () => screen.getByRole("list", { name: "Tareas de hoy" });
    const names = () =>
      within(list())
        .getAllByRole("link")
        .map((link) => link.textContent);

    await user.click(tomorrowKey(a.title));
    await waitFor(() => expect(names()).toEqual([b.title]));
    expect(postponeTask).toHaveBeenCalledExactlyOnceWith({ id: a.id, to: "tomorrow" });
    expect(tomorrowKey(b.title)).toHaveFocus();
    await answer(moved(a));

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(names()).toEqual([a.title, b.title]);
    expect(restoreTaskDueDate).toHaveBeenCalledExactlyOnceWith({
      id: a.id,
      dueDate: TODAY,
      expected: TOMORROW,
    });
    await answer(restored(a));
  });

  test("done rows get no keys", () => {
    render(
      <TasksScreen now={NOW} targets={TARGETS}>
        <h2 id="heading" tabIndex={-1}>
          Hoy
        </h2>
        <TodayView tasks={[listTask({ doneAt: NOW })]} headingId="heading" />
      </TasksScreen>,
    );
    expect(screen.queryByRole("button", { name: /^Pasar a mañana/ })).toBeNull();
  });
});
