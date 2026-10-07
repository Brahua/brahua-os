// D1 of `today`: the board on "/" (SPEC-today "Pantalla"). Sections without items are left out,
// the empty day, the slots of D2–D4, and "Hábitos" with its "X de N" and pads logged through
// the board's one notice viewport. Against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import type { HabitItem } from "@/modules/habits/habit-input";
import { logHabit, setHabitDone } from "@/modules/habits/log-actions";
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

const MEDITAR = habit({ name: "Meditar" });
const LEER = habit({ name: "Leer", quantity: 1 });
const AGUA = habit({
  name: "Agua",
  measure: "quantity",
  goal: 8,
  target: 8,
  unit: "vasos",
  step: 2,
});
const FUMAR = habit({ name: "No fumar", kind: "avoid" });

/** Calls wait until the test answers them (every one must settle before the test ends). */
const pending: ((result: ActionResult<HabitItem>) => void)[] = [];
async function answer(result: ActionResult<HabitItem>) {
  const call = pending.shift();
  if (!call) throw new Error("No pending call");
  await act(async () => call(result));
}

const habitsSection = () => screen.getByRole("region", { name: "Hábitos" });
const pads = () => screen.getByRole("list", { name: "Hábitos de hoy" });
const pad = (name: string) => within(pads()).getByRole("button", { name });
const count = () => document.querySelector("[data-today-habits-count]");
const notices = () => screen.getByRole("region", { name: "Avisos" });
/** The pads' habits, in the order shown (each cell names its habit by id). */
const padOrder = () =>
  within(pads())
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-habit-cell"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The sheets ask for reduced motion.
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  pending.length = 0;
  const wait = () =>
    new Promise<ActionResult<HabitItem>>((resolve) => {
      pending.push(resolve);
    });
  vi.mocked(setHabitDone).mockImplementation(wait);
  vi.mocked(logHabit).mockImplementation(wait);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("sections and the empty day", () => {
  test("no habits and no slots: the calm empty day with links, and no Hábitos section", () => {
    render(<TodayBoard today={TODAY} habits={[]} />);
    const empty = screen.getByRole("region", { name: "Nada programado para hoy" });
    expect(within(empty).getByRole("link", { name: "Ir a Hábitos" })).toHaveAttribute(
      "href",
      "/habits",
    );
    expect(within(empty).getByRole("link", { name: "Ir a Tareas" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.queryByRole("region", { name: "Hábitos" })).not.toBeInTheDocument();
    // Never guilt.
    expect(document.body.textContent).not.toMatch(/fallaste|atrasad|pendientes/i);
  });

  test("with habits due today: the Hábitos section, no empty day (positive control)", () => {
    render(<TodayBoard today={TODAY} habits={[MEDITAR]} />);
    expect(habitsSection()).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Nada programado para hoy" }),
    ).not.toBeInTheDocument();
    expect(within(habitsSection()).getByRole("link", { name: "Ver hábitos" })).toHaveAttribute(
      "href",
      "/habits",
    );
  });

  test("slots: D4 first, then Hábitos, Tareas (D2) and Proyectos (D3), in that order", () => {
    render(
      <TodayBoard
        today={TODAY}
        habits={[LEER]}
        dayComplete={{ tasksDoneToday: 1 }}
        tasks={{ count: 0, content: <section data-slot="tasks">Tareas</section> }}
        projects={{ count: 1, content: <section data-slot="projects">Proyectos</section> }}
      />,
    );
    const board = document.querySelector("[data-today-board]")!;
    const order = [...board.children].map(
      (child) =>
        child.getAttribute("data-slot") ??
        child.getAttribute("data-today-section") ??
        (child.hasAttribute("data-today-complete") ? "day-complete" : null),
    );
    expect(order).toEqual(["day-complete", "habits", "tasks", "projects"]);
  });

  test("Día completo with nothing left in the sections is never next to the empty day", () => {
    render(
      <TodayBoard
        today={TODAY}
        habits={[]}
        dayComplete={{ tasksDoneToday: 2 }}
        tasks={{ count: 0, content: <section data-slot="tasks">Tareas</section> }}
      />,
    );
    const board = document.querySelector("[data-today-board]")!;
    // The slot stays mounted at 0 (its section hides itself without rows: TodaySlot).
    expect(
      [...board.children].map(
        (child) =>
          child.getAttribute("data-slot") ??
          (child.hasAttribute("data-today-complete") ? "day-complete" : null),
      ),
    ).toEqual(["day-complete", "tasks"]);
    expect(
      screen.queryByRole("region", { name: "Nada programado para hoy" }),
    ).not.toBeInTheDocument();
  });

  test("a slot with 0 items counts toward the empty day but stays mounted; one with items keeps the day from being empty", () => {
    const { rerender } = render(
      <TodayBoard
        today={TODAY}
        habits={[]}
        tasks={{ count: 0, content: <section data-slot="tasks">Tareas</section> }}
      />,
    );
    // Mounted (a client section keeps its state, e.g. to undo its last row); it renders nothing
    // itself without rows. The day is empty by the count.
    expect(document.querySelector('[data-slot="tasks"]')).not.toBeNull();
    expect(screen.getByRole("region", { name: "Nada programado para hoy" })).toBeInTheDocument();

    rerender(
      <TodayBoard
        today={TODAY}
        habits={[]}
        tasks={{ count: 1, content: <section data-slot="tasks">Tareas</section> }}
      />,
    );
    expect(document.querySelector('[data-slot="tasks"]')).not.toBeNull();
    expect(
      screen.queryByRole("region", { name: "Nada programado para hoy" }),
    ).not.toBeInTheDocument();
  });
});

describe("a new Lima day with the board open", () => {
  const YESTERDAY = "2026-10-01";
  const becomeVisible = () => act(() => document.dispatchEvent(new Event("visibilitychange")));

  test("the empty day is read again once, and it is said", async () => {
    const { container } = render(<TodayBoard today={YESTERDAY} habits={[]} />);
    await becomeVisible();
    await becomeVisible();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(container.querySelector("[data-screen-announcer]")).toHaveTextContent(
        "Empezó un nuevo día: actualizando Hoy.",
      ),
    );
  });

  test("with habits: one refresh (the board's, not habits' too) and no log of the day before", async () => {
    const user = userEvent.setup();
    const { container } = render(<TodayBoard today={YESTERDAY} habits={[MEDITAR]} />);
    await becomeVisible();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await user.click(pad("Meditar"));
    expect(setHabitDone).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(container.querySelector("[data-screen-announcer]")).toHaveTextContent(
        "Empezó un nuevo día: actualizando Hoy.",
      ),
    );
  });

  test("on the same day nothing is refreshed (positive control above)", async () => {
    render(<TodayBoard today={TODAY} habits={[MEDITAR]} />);
    await becomeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("Hábitos", () => {
  test("“X de N” counts with habits' rule (an avoid without a relapse is done)", () => {
    render(<TodayBoard today={TODAY} habits={[MEDITAR, LEER, AGUA, FUMAR]} />);
    // Leer (done) and No fumar (clean) of 4.
    expect(count()).toHaveTextContent("2 de 4 cumplidos");
    expect(within(pads()).getAllByRole("button", { name: /^(?!Ajustar|Opciones)/ })).toHaveLength(
      4,
    );
  });

  test("a tap logs today, the count follows, the pads don't move; Deshacer in the one viewport", async () => {
    const user = userEvent.setup();
    const { container } = render(<TodayBoard today={TODAY} habits={[MEDITAR, LEER, AGUA]} />);
    expect(padOrder()).toEqual([MEDITAR.id, LEER.id, AGUA.id]);

    await user.click(pad("Meditar"));
    // Optimistic at once, and still in its place (manual order).
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    expect(count()).toHaveTextContent("2 de 3");
    expect(padOrder()).toEqual([MEDITAR.id, LEER.id, AGUA.id]);
    expect(setHabitDone).toHaveBeenCalledWith({ id: MEDITAR.id, day: TODAY, done: true });
    await answer(ok({ ...MEDITAR, quantity: 1 }));

    // One notice viewport on the board (the host's).
    expect(screen.getAllByRole("region", { name: "Avisos" })).toHaveLength(1);
    expect(await within(notices()).findByText(/«Meditar» quedó hecho hoy/)).toBeInTheDocument();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(setHabitDone).toHaveBeenLastCalledWith({ id: MEDITAR.id, day: TODAY, done: false }),
    );
    await answer(ok(MEDITAR));
    await waitFor(() => expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false"));
    expect(count()).toHaveTextContent("1 de 3");
    await waitFor(() =>
      expect(container.querySelector("[data-screen-announcer]")).toHaveTextContent(
        "«Meditar» volvió a quedar sin marcar.",
      ),
    );
  });

  test("a quantity tap adds its step; only quantity pads have “Ajustar”", async () => {
    const user = userEvent.setup();
    render(<TodayBoard today={TODAY} habits={[MEDITAR, AGUA, FUMAR]} />);
    expect(within(pads()).getAllByRole("button", { name: /^Ajustar/ })).toHaveLength(1);
    expect(within(pads()).getByRole("button", { name: "Ajustar «Agua»" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );

    await user.click(pad("Agua"));
    expect(pad("Agua")).toHaveAccessibleDescription(/2 de 8 vasos/);
    await waitFor(() =>
      expect(logHabit).toHaveBeenCalledWith({ id: AGUA.id, day: TODAY, delta: 2 }),
    );
    await answer(ok({ ...AGUA, quantity: 2 }));
    expect(await within(notices()).findByText(/«Agua»: 2 de 8 vasos hoy/)).toBeInTheDocument();
  });

  test("a habit to avoid logs a relapse with one tap", async () => {
    const user = userEvent.setup();
    render(<TodayBoard today={TODAY} habits={[FUMAR]} />);
    expect(count()).toHaveTextContent("1 de 1");
    await user.click(within(pads()).getByRole("button", { name: "Registrar recaída: No fumar" }));
    expect(count()).toHaveTextContent("0 de 1");
    expect(setHabitDone).toHaveBeenCalledWith({ id: FUMAR.id, day: TODAY, done: true });
    await answer(ok({ ...FUMAR, quantity: 1 }));
  });

  test("Ctrl+Z after a tap undoes it, like the notice's Deshacer", async () => {
    const user = userEvent.setup();
    render(<TodayBoard today={TODAY} habits={[MEDITAR]} />);
    await user.click(pad("Meditar"));
    await answer(ok({ ...MEDITAR, quantity: 1 }));
    expect(await within(notices()).findByText(/«Meditar» quedó hecho hoy/)).toBeInTheDocument();

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() =>
      expect(setHabitDone).toHaveBeenLastCalledWith({ id: MEDITAR.id, day: TODAY, done: false }),
    );
    await answer(ok(MEDITAR));
    await waitFor(() => expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false"));
  });

  test("closing Ajustar after its pad left puts focus on the Hábitos heading", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TodayBoard today={TODAY} habits={[AGUA, MEDITAR]} />);
    await user.click(within(pads()).getByRole("button", { name: "Ajustar «Agua»" }));
    const sheet = await screen.findByRole("dialog", { name: "Ajustar «Agua»" });
    expect(sheet).toBeInTheDocument();
    // Agua leaves the board meanwhile (archived from another tab): its key is gone.
    rerender(<TodayBoard today={TODAY} habits={[MEDITAR]} />);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ajustar «Agua»" })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Hábitos" })).toHaveFocus(),
    );
  });

  test("a refusal rolls the pad back and says so in the board's viewport", async () => {
    const user = userEvent.setup();
    render(<TodayBoard today={TODAY} habits={[MEDITAR]} />);
    await user.click(pad("Meditar"));
    await answer(fail("Este hábito está archivado: reactívalo para registrarlo."));
    // The rollback can come after the notice: wait for it.
    await waitFor(() => expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false"));
    expect(
      await within(notices()).findByText(/No se pudo registrar\. Este hábito está archivado/),
    ).toBeInTheDocument();
    expect(count()).toHaveTextContent("0 de 1");
  });
});
