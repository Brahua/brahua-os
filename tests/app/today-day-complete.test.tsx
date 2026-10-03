// D4 of `today`: "Día completo" on the board (SPEC-today, principle 8). What it says (singulars,
// the line of the day), that it follows the sections' live state (it shows when the last thing is
// done, before the server answers, and leaves when that is undone), that it is announced once per
// live appearance (never on load), and that it never takes focus. Against a fake server, inside
// the real board.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import type { TaskItem } from "@/modules/tasks/task-input";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import { dayCompleteMessage } from "@/modules/today/components/day-complete";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayTasks } from "@/modules/today/components/today-tasks";
import { TODAY_HEADING_ID } from "@/modules/today/today-board";
import { TODAY_COPY } from "@/modules/today/today-copy";

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
vi.mock("@/modules/tasks/recurrence-actions", () => ({
  completeTaskWithNext: vi.fn(),
  reopenTaskWithSpawn: vi.fn(),
}));

/** Friday 2026-10-02, 10:00 in Lima. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

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

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<unknown>) => void)[] = [];
async function answer(result: ActionResult<unknown>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}
const completed = () => ok({ task: {} as TaskItem, next: null, nextInbox: null });

type BoardProps = { habits?: HabitItem[]; tasks?: TaskTodayItem[]; doneToday?: number };
function Board({ habits = [], tasks = [], doneToday = 0 }: BoardProps) {
  return (
    <>
      <h1 id={TODAY_HEADING_ID} tabIndex={-1}>
        Buenos días
      </h1>
      <TodayBoard
        today={TODAY}
        habits={habits}
        tasks={{ count: tasks.length, content: <TodayTasks tasks={tasks} /> }}
        dayComplete={{ tasksDoneToday: doneToday }}
      />
    </>
  );
}

const block = () => screen.queryByRole("region", { name: "Día completo" });
const achieved = () => document.querySelector("[data-today-complete-achieved]");
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-screen-announcer]")!;

/** Every non-empty text the board's announcer says from now on (it clears itself first). */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver(() => {
    const text = announcer().textContent ?? "";
    if (text) said.push(text);
  });
  observer.observe(announcer(), { childList: true, characterData: true, subtree: true });
  observers.push(observer);
  return said;
}
const observers: MutationObserver[] = [];
/** The announcer writes after 50 ms: wait past it before saying nothing was announced. */
const pastAnnouncerDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, 120)));

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
  vi.mocked(setHabitDone).mockImplementation(wait);
  vi.mocked(completeTaskWithNext).mockImplementation(wait);
  vi.mocked(reopenTaskWithSpawn).mockImplementation(wait);
});

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what it says", () => {
  test("loaded already complete: title, the line of the day and what was achieved; no fade, no announcement", async () => {
    const said = recordAnnouncementsAfter(() =>
      render(<Board habits={[habit({ quantity: 1 }), habit({ quantity: 1 })]} doneToday={4} />),
    );
    const region = block()!;
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole("heading", { level: 2, name: "Día completo" })).toBeVisible();
    expect(region).toHaveTextContent(dayCompleteMessage(TODAY));
    expect(achieved()).toHaveTextContent("Logrado hoy: 2 hábitos · 4 tareas");
    // The middle dot is decoration: not read.
    expect(achieved()!.querySelector('[aria-hidden="true"]')).toHaveTextContent("·");
    // Not live: no fade and nothing announced.
    expect(region).not.toHaveAttribute("data-appeared");
    await pastAnnouncerDelay();
    expect(said).toEqual([]);
    // Never guilt, never a debt counter.
    expect(region.textContent).not.toMatch(/fallaste|atrasad|pendiente/i);
  });

  test.each([
    ["1 hábito", { habits: [habit({ quantity: 1 })], doneToday: 0 }],
    ["1 tarea", { habits: [], doneToday: 1 }],
    ["1 hábito · 1 tarea", { habits: [habit({ quantity: 1 })], doneToday: 1 }],
    ["3 tareas", { habits: [], doneToday: 3 }],
  ])("singulars and plurals: %s", (text, props) => {
    render(<Board {...props} />);
    expect(achieved()).toHaveTextContent(`Logrado hoy: ${text}`);
  });

  test("the line is the same all day (stable, no mismatch) and one of the variants", () => {
    const line = dayCompleteMessage(TODAY);
    expect(TODAY_COPY.dayCompleteMessages).toContain(line);
    expect(dayCompleteMessage(TODAY)).toBe(line);
    // Across a month, it varies.
    const lines = new Set(
      Array.from({ length: 30 }, (_, index) =>
        dayCompleteMessage(`2026-10-${String(index + 1).padStart(2, "0")}`),
      ),
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  test("not complete: a habit or a task left, an empty day, or only clean habits to avoid", () => {
    const { rerender } = render(<Board habits={[habit()]} doneToday={3} />);
    expect(block()).toBeNull();
    rerender(<Board tasks={[task()]} doneToday={3} />);
    expect(block()).toBeNull();
    rerender(<Board />);
    expect(block()).toBeNull();
    expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeInTheDocument();
    rerender(<Board habits={[habit({ kind: "avoid", name: "No fumar" })]} />);
    expect(block()).toBeNull();
    // Positive control: the same avoid habit with a task completed today.
    rerender(<Board habits={[habit({ kind: "avoid", name: "No fumar" })]} doneToday={1} />);
    expect(block()).toBeInTheDocument();
  });
});

describe("live", () => {
  test("completing the last task shows it at once (before the server), +1 task; Deshacer takes it away", async () => {
    const informe = task({ title: "Enviar informe" });
    const leer = habit({ quantity: 1 });
    let rerender!: ReturnType<typeof render>["rerender"];
    const said = recordAnnouncementsAfter(() => {
      ({ rerender } = render(<Board habits={[leer]} tasks={[informe]} doneToday={2} />));
    });
    expect(block()).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", { name: "Hecha: Enviar informe" }));
    // Optimistic: shown before the server answers, with the completion counted.
    expect(block()).toBeInTheDocument();
    expect(block()).toHaveAttribute("data-appeared");
    expect(achieved()).toHaveTextContent("1 hábito · 3 tareas");
    // It never takes focus: the board's heading has it (the section left with its last row).
    await waitFor(() => expect(document.getElementById(TODAY_HEADING_ID)).toHaveFocus());
    await waitFor(() => expect(said).toEqual(["Día completo: 1 hábito y 3 tareas."]));

    // The server answers with the revalidated page (as a Server Action does): nothing pending,
    // 3 done today. Still complete, with the same numbers.
    rerender(<Board habits={[leer]} tasks={[]} doneToday={3} />);
    await answer(completed());
    expect(block()).toBeInTheDocument();
    expect(achieved()).toHaveTextContent("1 hábito · 3 tareas");

    // Deshacer: pending again, so the day isn't complete any more (before the server answers).
    await userEvent.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(block()).toBeNull();
    rerender(<Board habits={[leer]} tasks={[informe]} doneToday={2} />);
    await answer(ok({ task: {} as TaskItem, spawn: null }));
    expect(block()).toBeNull();
    await pastAnnouncerDelay();
    // Only once, and the undo isn't announced as a completion.
    expect(said.filter((text) => text.startsWith("Día completo"))).toHaveLength(1);
  });

  test("the server's read after the last completion keeps it, without a second announcement", async () => {
    const informe = task({ title: "Enviar informe" });
    let rerender!: ReturnType<typeof render>["rerender"];
    const said = recordAnnouncementsAfter(() => {
      ({ rerender } = render(<Board tasks={[informe]} doneToday={0} />));
    });

    await userEvent.click(screen.getByRole("checkbox", { name: "Hecha: Enviar informe" }));
    expect(achieved()).toHaveTextContent("1 tarea");
    // The revalidated page arrives with the answer: no task pending, one done today.
    rerender(<Board tasks={[]} doneToday={1} />);
    await answer(completed());
    expect(block()).toBeInTheDocument();
    expect(achieved()).toHaveTextContent("1 tarea");
    expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
    await pastAnnouncerDelay();
    expect(said).toEqual(["Día completo: 1 tarea."]);
  });

  test("tapping the last habit shows it; undoing it takes it away; again, announced again", async () => {
    const meditar = habit({ name: "Meditar" });
    const leer = habit({ name: "Leer", quantity: 1 });
    const done = { ...meditar, quantity: 1 };
    let rerender!: ReturnType<typeof render>["rerender"];
    const said = recordAnnouncementsAfter(() => {
      ({ rerender } = render(<Board habits={[meditar, leer]} />));
    });
    expect(block()).toBeNull();

    const pad = screen.getByRole("button", { name: "Meditar" });
    await userEvent.click(pad);
    expect(block()).toBeInTheDocument();
    expect(achieved()).toHaveTextContent("2 hábitos");
    // Focus stays on the pad that was tapped.
    expect(pad).toHaveFocus();
    // The answer comes with the revalidated page.
    rerender(<Board habits={[done, leer]} />);
    await answer(ok(done));
    expect(block()).toBeInTheDocument();
    await waitFor(() => expect(said).toEqual(["Día completo: 2 hábitos."]));

    await userEvent.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(block()).toBeNull();
    rerender(<Board habits={[meditar, leer]} />);
    await answer(ok(meditar));
    expect(block()).toBeNull();

    // A new appearance is announced again (once).
    await userEvent.click(screen.getByRole("button", { name: "Meditar" }));
    expect(block()).toBeInTheDocument();
    rerender(<Board habits={[done, leer]} />);
    await answer(ok(done));
    await waitFor(() =>
      expect(said.filter((text) => text.startsWith("Día completo"))).toHaveLength(2),
    );
  });
});

/** Renders, then records what is announced from that moment (the announcer must exist first). */
function recordAnnouncementsAfter(renderBoard: () => void): string[] {
  renderBoard();
  return recordAnnouncements();
}
