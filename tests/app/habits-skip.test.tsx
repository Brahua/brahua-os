// "Saltar hoy" (polish) on /habits "Hoy": the key in the options sheet (not for a habit to avoid
// or one already resting), the pad moving to "En pausa" at once, the LCD notice with its exact
// "Deshacer", focus, the failures, against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import type { HabitItem } from "@/modules/habits/habit-input";
import { skipHabitToday, undoSkipHabit } from "@/modules/habits/skip-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/habits/actions", () => ({
  createHabit: vi.fn(),
  deleteHabit: vi.fn(),
  restoreHabit: vi.fn(),
}));
vi.mock("@/modules/habits/organize-actions", () => ({
  updateHabit: vi.fn(),
  reorderHabits: vi.fn(),
  archiveHabit: vi.fn(),
  unarchiveHabit: vi.fn(),
}));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  logHabit: vi.fn(),
  setHabitQuantity: vi.fn(),
}));
vi.mock("@/modules/habits/pause-actions", () => ({
  pauseHabit: vi.fn(),
  resumeHabit: vi.fn(),
  removeHabitPause: vi.fn(),
}));
vi.mock("@/modules/habits/skip-actions", () => ({
  skipHabitToday: vi.fn(),
  undoSkipHabit: vi.fn(),
}));

const TODAY = "2026-10-02";
const NOW = new Date("2026-10-02T15:00:00.000Z");
const SKIP_PAUSE_ID = "00000000-0000-4000-8000-0000000000cc";

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
    startDate: "2026-09-01",
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

const GYM = habit({ name: "Gimnasio", streak: { unit: "days", done: 5, notDone: 4 } });
const LEER = habit({ name: "Leer" });
const AGUA = habit({ name: "Agua", measure: "quantity", goal: 8, target: 8, unit: "vasos" });
const FUMAR = habit({ name: "No fumar", kind: "avoid" });
const VIAJE = habit({
  name: "Correr",
  pause: {
    id: "00000000-0000-4000-8000-0000000000aa",
    startDate: "2026-09-30",
    endDate: "2026-10-09",
    reason: "Viaje",
  },
});
const HABITS = [GYM, LEER, AGUA, FUMAR, VIAJE];

const server = {
  habits: HABITS,
  render: (() => {}) as (habits: HabitItem[]) => void,
  pending: [] as { answer: (result?: ActionResult<unknown>) => void }[],
  async answer(result?: ActionResult<unknown>) {
    const call = server.pending.shift();
    if (!call) throw new Error("No pending call");
    await act(async () => call.answer(result));
  },
  async answerAll() {
    while (server.pending.length > 0) await server.answer();
  },
};

function serverChange<T>(
  id: string,
  change: (item: HabitItem) => HabitItem,
  data: (item: HabitItem) => T,
) {
  return new Promise<ActionResult<T>>((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.habits = server.habits.map((item) => (item.id === id ? change(item) : item));
          server.render(server.habits);
        }
        const saved = server.habits.find((item) => item.id === id)!;
        resolve((result as ActionResult<T>) ?? ok(data(saved)));
      },
    });
  });
}

function Harness() {
  const [habits, setHabits] = useState(server.habits);
  useLayoutEffect(() => {
    server.render = setHabits;
  }, []);
  return (
    <HabitsScreen today={TODAY} areas={[]}>
      <HabitsToday habits={habits} headingId="habits-title" />
    </HabitsScreen>
  );
}

const SKIP = { id: SKIP_PAUSE_ID, startDate: TODAY, endDate: TODAY, reason: "Descanso" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.habits = HABITS;
  server.pending = [];
  vi.mocked(skipHabitToday)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => ({ ...item, pause: SKIP }),
        (item) => ({ habit: item, pause: SKIP, changed: true }),
      );
    });
  vi.mocked(undoSkipHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => ({ ...item, pause: null }),
        (item) => ({ habit: item, removed: true }),
      );
    });
});

afterEach(async () => {
  await server.answerAll();
  vi.useRealTimers();
});

const pad = (name: string) => screen.getByRole("button", { name });
const count = () => document.querySelector("[data-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });

async function openOptions(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
  return screen.findByRole("dialog", { name });
}

async function skip(user: ReturnType<typeof userEvent.setup>, name: string) {
  const options = await openOptions(user, name);
  await user.click(within(options).getByRole("button", { name: "Saltar hoy" }));
}

describe("the key", () => {
  test("is in the options of a habit to keep, with its help, and is a full-size key", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const name of ["Gimnasio", "Agua"]) {
      const options = await openOptions(user, name);
      const key = within(options).getByRole("button", { name: "Saltar hoy" });
      expect(key).toHaveAccessibleDescription(/no suma ni rompe la racha/);
      // Icon + text, in the design system's key (48 px tall).
      expect(key.querySelector("svg")).not.toBeNull();
      expect(key).toHaveClass("bo-key");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  test("not for a habit to avoid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "No fumar");
    expect(within(options).getByRole("button", { name: "Pausar" })).toBeVisible();
    expect(within(options).queryByRole("button", { name: "Saltar hoy" })).not.toBeInTheDocument();
  });

  test("not for a habit already resting today (it offers Reanudar instead)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    await user.click(screen.getByRole("button", { name: "Opciones de «Correr»" }));
    const options = await screen.findByRole("dialog", { name: "Correr" });
    expect(within(options).getByRole("button", { name: "Reanudar" })).toBeVisible();
    expect(within(options).queryByRole("button", { name: "Saltar hoy" })).not.toBeInTheDocument();
  });
});

describe("skipping today", () => {
  test("two taps: the pad rests at once (out of the grid and the count), the notice undoes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(count()).toBe("1 de 4 hoy");
    await skip(user, "Gimnasio");
    expect(skipHabitToday).toHaveBeenCalledWith({ id: GYM.id });
    // Optimistic: before the server answers.
    const grid = screen.getByRole("list", { name: "Hábitos de hoy" });
    expect(within(grid).queryByRole("button", { name: "Gimnasio" })).not.toBeInTheDocument();
    expect(count()).toBe("1 de 3 hoy");
    await server.answer();
    expect(within(notices()).getByText("Descanso")).toBeVisible();
    expect(within(notices()).getByText("«Gimnasio» descansa hoy.")).toBeVisible();
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeVisible();
    // It is in "En pausa" with its reason; focus is there (never <body>).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reanudar «Gimnasio»" })).toHaveFocus(),
    );
    const resting = screen.getByRole("list", { name: "Hábitos en pausa" });
    expect(within(resting).getByText("En pausa hasta el 2 de octubre · Descanso")).toBeVisible();
  });

  test("Deshacer removes THAT pause by its id and the pad comes back with its focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await skip(user, "Gimnasio");
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(undoSkipHabit).toHaveBeenCalledWith({ id: GYM.id, pauseId: SKIP_PAUSE_ID });
    // At once, before the answer.
    expect(pad("Gimnasio")).toBeVisible();
    expect(count()).toBe("1 de 4 hoy");
    await server.answer();
    await waitFor(() => expect(pad("Gimnasio")).toHaveFocus());
    // The streak (open day: 4) was never touched by the rest.
    expect(pad("Gimnasio").querySelector("[data-habit-streak]")?.textContent).toBe("RACHA 4");
  });

  test("a failure rolls back with 'Sin guardar' and the pad returns", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await skip(user, "Leer");
    expect(screen.queryByRole("button", { name: "Leer" })).not.toBeInTheDocument();
    await server.answer(fail("No se pudo."));
    await waitFor(() => expect(pad("Leer")).toBeVisible());
    expect(within(notices()).getByText("Sin guardar")).toBeVisible();
    expect(within(notices()).getByText(/No se pudo saltar\./)).toBeVisible();
    expect(count()).toBe("1 de 4 hoy");
    // Focus is never on <body>.
    expect(document.body).not.toHaveFocus();
  });

  test("a quantity habit rests the same way", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await skip(user, "Agua");
    await server.answer();
    expect(within(notices()).getByText("«Agua» descansa hoy.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agua" })).not.toBeInTheDocument();
  });

  test("when the server found today already resting, the notice has no Deshacer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    vi.mocked(skipHabitToday).mockImplementationOnce(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => ({ ...item, pause: SKIP }),
        (item) => ({ habit: item, pause: SKIP, changed: false }),
      );
    });
    await skip(user, "Leer");
    await server.answer();
    expect(within(notices()).getByText("«Leer» descansa hoy.")).toBeVisible();
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("a rest the owner made longer: Deshacer says it stayed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await skip(user, "Leer");
    await server.answer();
    vi.mocked(undoSkipHabit).mockImplementationOnce(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => item,
        (item) => ({ habit: item, removed: false }),
      );
    });
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await server.answer();
    expect(
      await screen.findByText(/ya dura más de un día: se dejó como estaba/),
    ).toBeInTheDocument();
  });
});
