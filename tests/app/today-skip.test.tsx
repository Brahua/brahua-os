// "Saltar hoy" (polish) on the board (/): every pad has a corner key that opens a little sheet
// with "Saltar hoy" (not for a habit to avoid); the pad leaves at once, "Descanso · Deshacer"
// brings it back by the exact pause id, focus never lands on <body>. Against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "@/modules/habits/habit-input";
import { skipHabitToday, undoSkipHabit } from "@/modules/habits/skip-actions";
import { TodayBoard } from "@/modules/today/components/today-board";

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
vi.mock("@/modules/habits/skip-actions", () => ({
  skipHabitToday: vi.fn(),
  undoSkipHabit: vi.fn(),
}));

const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);
const SKIP_PAUSE_ID = "00000000-0000-4000-8000-0000000000cc";
const SKIP = { id: SKIP_PAUSE_ID, startDate: TODAY, endDate: TODAY, reason: "Descanso" };

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

const MEDITAR = habit({ name: "Meditar" });
const LEER = habit({ name: "Leer" });
const AGUA = habit({
  name: "Agua",
  measure: "quantity",
  goal: 8,
  target: 8,
  unit: "vasos",
  step: 2,
});
const FUMAR = habit({ name: "No fumar", kind: "avoid" });
const HABITS = [MEDITAR, LEER, AGUA, FUMAR];

let rested: string[] = [];
let base = HABITS;
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
          // The revalidation: a rested habit is no longer "due today" for the board.
          const changed = change(HABITS.find((item) => item.id === id) as HabitItem);
          rested = changed.pause === null ? rested.filter((r) => r !== id) : [...rested, id];
          server.habits = base.filter((item) => !rested.includes(item.id));
          server.render(server.habits);
        }
        const saved = { ...(HABITS.find((item) => item.id === id) as HabitItem) };
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
    <>
      <h1 id="today-title" tabIndex={-1}>
        Hoy
      </h1>
      <TodayBoard today={TODAY} habits={habits} />
    </>
  );
}

const pads = () => screen.getByRole("list", { name: "Hábitos de hoy" });
const pad = (name: string) => within(pads()).getByRole("button", { name });
const count = () => document.querySelector("[data-today-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });

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
  rested = [];
  base = HABITS;
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

async function openSheet(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(pads()).getByRole("button", { name: `Opciones de «${name}»` }));
  return screen.findByRole("dialog", { name });
}

describe("the corner key and its sheet", () => {
  test("every pad to keep has its options key, a habit to avoid none; a quantity pad keeps 'Ajustar'", () => {
    render(<Harness />);
    expect(
      within(pads()).queryByRole("button", { name: "Opciones de «No fumar»" }),
    ).not.toBeInTheDocument();
    for (const name of ["Meditar", "Leer", "Agua"]) {
      expect(
        within(pads()).getByRole("button", { name: `Opciones de «${name}»` }),
      ).toBeInTheDocument();
    }
    expect(within(pads()).getByRole("button", { name: /Ajustar/ })).toBeInTheDocument();
    expect(within(pads()).getAllByRole("button", { name: /Ajustar/ })).toHaveLength(1);
  });

  test("the sheet offers Saltar hoy for a habit to keep, a full-size key with help", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const name of ["Meditar", "Agua"]) {
      const sheet = await openSheet(user, name);
      const key = within(sheet).getByRole("button", { name: "Saltar hoy" });
      expect(key).toHaveAccessibleDescription(/no suma ni rompe la racha/);
      expect(key.querySelector("svg")).not.toBeNull();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  test("closing the sheet without skipping returns focus to the corner key", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openSheet(user, "Leer");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(within(pads()).getByRole("button", { name: "Opciones de «Leer»" })).toHaveFocus(),
    );
  });
});

describe("skipping from the board", () => {
  test("two taps: the pad leaves at once (and the count), focus goes to its neighbor", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(count()).toContain("1 de 4");
    const sheet = await openSheet(user, "Leer");
    await user.click(within(sheet).getByRole("button", { name: "Saltar hoy" }));
    expect(skipHabitToday).toHaveBeenCalledWith({ id: LEER.id });
    expect(within(pads()).queryByRole("button", { name: "Leer" })).not.toBeInTheDocument();
    expect(count()).toContain("1 de 3");
    await waitFor(() => expect(pad("Agua")).toHaveFocus());
    await server.answer();
    expect(within(notices()).getByText("Descanso")).toBeVisible();
    expect(within(notices()).getByText("«Leer» descansa hoy.")).toBeVisible();
    expect(within(pads()).queryByRole("button", { name: "Leer" })).not.toBeInTheDocument();
  });

  test("Deshacer removes that exact pause; the pad is back and takes focus from the notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openSheet(user, "Leer");
    await user.click(within(sheet).getByRole("button", { name: "Saltar hoy" }));
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(undoSkipHabit).toHaveBeenCalledWith({ id: LEER.id, pauseId: SKIP_PAUSE_ID });
    await server.answer();
    await waitFor(() => expect(pad("Leer")).toHaveFocus());
    expect(count()).toContain("1 de 4");
  });

  test("the last pad resting: focus on the board's heading, and Deshacer still puts it back at once", async () => {
    const user = userEvent.setup();
    base = [MEDITAR];
    server.habits = base;
    render(<Harness />);
    const sheet = await openSheet(user, "Meditar");
    await user.click(within(sheet).getByRole("button", { name: "Saltar hoy" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hoy" })).toHaveFocus());
    await server.answer();
    // The server's read is empty now: no section, but the notice's Deshacer has a live component.
    expect(screen.queryByRole("region", { name: "Hábitos" })).not.toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(pad("Meditar")).toBeVisible();
    await server.answer();
    await waitFor(() => expect(pad("Meditar")).toHaveFocus());
  });

  test("a failure rolls back: the pad returns with 'Sin guardar'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openSheet(user, "Meditar");
    await user.click(within(sheet).getByRole("button", { name: "Saltar hoy" }));
    await server.answer(fail("No se pudo."));
    await waitFor(() => expect(pad("Meditar")).toBeVisible());
    expect(within(notices()).getByText("Sin guardar")).toBeVisible();
    expect(count()).toContain("1 de 4");
  });
});
