// H6 of `habits`: logging from another module's screen (the future `today` board). A host screen
// gives its queue, notices and announcer through core's `ScreenServicesProvider`; habits' parts
// run inside `HabitsScreenWithin` with `HabitPad` and the logging hooks (`useDayLog`,
// `useQuantityLog`), like the "Tareas" section inside a project. Against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOptimistic, useTransition } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { HabitPad } from "@/modules/habits/components/habit-pad";
import { HabitsScreenWithin } from "@/modules/habits/components/habits-screen";
import { useDayLog } from "@/modules/habits/components/use-day-log";
import { useQuantityLog } from "@/modules/habits/components/use-quantity-log";
import type { HabitItem } from "@/modules/habits/habit-input";
import { applyHabitListChange } from "@/modules/habits/habit-list-optimistic";
import { logHabit, setHabitDone } from "@/modules/habits/log-actions";

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

/** Lima's real today: the day check (`isCurrentDay`) reads the real clock. */
const TODAY = ownerDateKey(new Date());

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
    streak: { unit: "days", done: 1, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
    ...values,
  };
}

const MEDITAR = habit({ name: "Meditar" });
const AGUA = habit({ name: "Agua", measure: "quantity", goal: 8, target: 8, unit: "vasos" });

/** What a host's board would do with the habits due today: pads and the logging hooks. */
function Board({ habits }: { habits: HabitItem[] }) {
  const [view, apply] = useOptimistic(habits, applyHabitListChange);
  const [, startSaving] = useTransition();
  const { toggle } = useDayLog({ view, apply, startSaving, notSaved: hostNotSaved });
  const quantity = useQuantityLog({
    view,
    apply,
    startSaving,
    notSaved: hostNotSaved,
    focusFallback: () => {},
  });
  return (
    <ul aria-label="Hábitos de hoy">
      {view.map((item) => (
        <li key={item.id}>
          <HabitPad habit={item} onToggle={toggle} onAdd={quantity.add} />
        </li>
      ))}
    </ul>
  );
}

/** The host's "Sin guardar" (a host shows the failure with its own notices). */
let hostNotSaved: (text: string, reason: string) => void = () => {};

/** Another module's screen: its own queue, notice viewport ("Avisos de hoy") and announcer. */
function Host({ habits }: { habits: HabitItem[] }) {
  return (
    <ScreenServicesProvider label="Avisos de hoy" actionHint="Deshacer con ⌘Z">
      <HabitsScreenWithin today={TODAY} areas={[]}>
        <Board habits={habits} />
      </HabitsScreenWithin>
    </ScreenServicesProvider>
  );
}

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<HabitItem>) => void)[] = [];
async function answer(result: ActionResult<HabitItem>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}

const pad = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const notices = () => screen.getByRole("region", { name: "Avisos de hoy" });

beforeEach(() => {
  pending.length = 0;
  hostNotSaved = () => {};
  const wait = () =>
    new Promise<ActionResult<HabitItem>>((resolve) => {
      pending.push(resolve);
    });
  vi.mocked(setHabitDone).mockImplementation(wait);
  vi.mocked(logHabit).mockImplementation(wait);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("habits inside a host screen (ScreenServicesContext)", () => {
  test("a yes/no tap logs today through the host's queue; Deshacer and its announcement too", async () => {
    const user = userEvent.setup();
    const { container } = render(<Host habits={[MEDITAR]} />);
    // Habits brings no viewport or announcer of its own: the host's only.
    expect(container.querySelector("[data-habits-announcer]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Avisos" })).not.toBeInTheDocument();

    await user.click(pad("Meditar"));
    // Optimistic at once.
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    expect(setHabitDone).toHaveBeenCalledWith({ id: MEDITAR.id, day: TODAY, done: true });
    await answer(ok({ ...MEDITAR, quantity: 1 }));

    // The notice lands in the host's viewport, with "Deshacer".
    expect(await within(notices()).findByText(/«Meditar» quedó hecho hoy/)).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: MEDITAR.id, day: TODAY, done: false });
    await answer(ok(MEDITAR));
    // The undo is only announced, by the host's announcer.
    await waitFor(() =>
      expect(container.querySelector("[data-screen-announcer]")).toHaveTextContent(
        "«Meditar» volvió a quedar sin marcar.",
      ),
    );
  });

  test("a quantity tap adds its step through the host's queue", async () => {
    const user = userEvent.setup();
    render(<Host habits={[AGUA]} />);
    await user.click(pad("Agua"));
    expect(logHabit).toHaveBeenCalledWith({ id: AGUA.id, day: TODAY, delta: 1 });
    await answer(ok({ ...AGUA, quantity: 1 }));
    expect(await within(notices()).findByText(/Agua/)).toBeInTheDocument();
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  test("a refusal rolls the pad back and the host says so", async () => {
    const said = vi.fn();
    hostNotSaved = said;
    const user = userEvent.setup();
    render(<Host habits={[MEDITAR]} />);
    await user.click(pad("Meditar"));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    await answer(fail("Este hábito está archivado: reactívalo para registrarlo."));
    // The rollback can come after the failure is reported: wait for it.
    await waitFor(() => expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false"));
    expect(said).toHaveBeenCalledWith(
      "No se pudo registrar.",
      "Este hábito está archivado: reactívalo para registrarlo.",
    );
  });

  test("outside a host screen, HabitsScreenWithin refuses to run (positive control above)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <HabitsScreenWithin today={TODAY} areas={[]}>
          <p>x</p>
        </HabitsScreenWithin>,
      ),
    ).toThrow(/inside a screen provider/);
    error.mockRestore();
  });
});
