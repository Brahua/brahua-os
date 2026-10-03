// H3 of `habits` on /habits "Hoy": a quantity's pad (a tap adds the step, Deshacer subtracts
// it), "Ajustar el día", a habit to avoid (a relapse with one tap) and the create form's "Tipo"
// and "Medición" (with "Varias veces al día"), against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createHabit } from "@/modules/habits/actions";
import { updateHabit } from "@/modules/habits/organize-actions";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { HABIT_ERRORS, type HabitItem } from "@/modules/habits/habit-input";
import { logHabit, setHabitDone, setHabitQuantity } from "@/modules/habits/log-actions";
import { MEASURE_ERRORS } from "@/modules/habits/measure-copy";

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

const TODAY = "2026-10-02";
/** 10:00 in Lima on TODAY. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");

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

const quantityHabit = (values: Partial<HabitItem>) =>
  habit({ measure: "quantity", goal: 8, target: 8, unit: "vasos", step: 1, ...values });

const AGUA = quantityHabit({ name: "Agua", quantity: 3, hasLogs: true });
const MEDICACION = quantityHabit({
  name: "Medicación",
  goal: 2,
  target: 2,
  unit: "veces",
  quantity: 1,
});
const FUMAR = habit({
  name: "No fumar",
  kind: "avoid",
  // H4: 12 clean days with today; a relapse today starts again.
  streak: { unit: "days", done: 12, notDone: 0 },
});
const LEER = habit({ name: "Leer" });
const HABITS = [AGUA, MEDICACION, FUMAR, LEER];

/**
 * A fake server: each action waits until the test answers it (in order), then applies the change
 * and re-renders the list with it, like the revalidation.
 */
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

function serverChange(id: string, change: (item: HabitItem) => HabitItem) {
  return new Promise<ActionResult<HabitItem>>((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.habits = server.habits.map((item) => (item.id === id ? change(item) : item));
          server.render(server.habits);
        }
        const saved = server.habits.find((item) => item.id === id)!;
        resolve((result as ActionResult<HabitItem>) ?? ok(saved));
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
  vi.mocked(setHabitDone)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, done } = input as { id: string; done: boolean };
      return serverChange(id, (item) => ({ ...item, quantity: done ? 1 : 0, hasLogs: true }));
    });
  vi.mocked(logHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, delta } = input as { id: string; delta: number };
      return serverChange(id, (item) => ({
        ...item,
        quantity: Math.min(Math.max(item.quantity + delta, 0), 99_999),
        hasLogs: true,
      }));
    });
  vi.mocked(setHabitQuantity)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, quantity } = input as { id: string; quantity: number };
      return serverChange(id, (item) => ({ ...item, quantity, hasLogs: true }));
    });
  vi.mocked(createHabit).mockReset();
});

afterEach(async () => {
  await server.answerAll();
  vi.useRealTimers();
});

const pad = (name: string) => screen.getByRole("button", { name });
const status = (name: string) => pad(name).querySelector(".bo-key__sub")?.textContent;
const count = () => document.querySelector("[data-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-habits-announcer]");

describe("a quantity pad", () => {
  test("3/8 VASOS with a short bar; a plain key described by what it holds", () => {
    render(<Harness />);
    expect(status("Agua")).toBe("3/8 VASOS");
    // A key that adds, not a toggle.
    expect(pad("Agua")).not.toHaveAttribute("aria-pressed");
    expect(pad("Agua")).toHaveAccessibleDescription("3 de 8 vasos. Suma 1 cada vez.");
    const bar = pad("Agua").querySelector(".bo-segbar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar?.querySelectorAll(".bo-segbar__seg")).toHaveLength(8);
    expect(bar?.querySelectorAll(".is-filled")).toHaveLength(3);
    // A clean habit to avoid counts as done; the others aren't yet.
    expect(count()).toBe("1 de 4 hoy");
  });

  test("a tap adds the step at once; Deshacer subtracts the same", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    expect(status("Agua")).toBe("4/8 VASOS");
    expect(logHabit).toHaveBeenCalledWith({ id: AGUA.id, day: TODAY, delta: 1 });
    expect(pad("Agua")).toHaveFocus();
    await server.answer();
    expect(within(notices()).getByText("«Agua»: 4 de 8 vasos hoy. 1 de 4 hoy.")).toBeVisible();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(status("Agua")).toBe("3/8 VASOS");
    expect(logHabit).toHaveBeenLastCalledWith({ id: AGUA.id, day: TODAY, delta: -1 });
    await server.answer();
    await waitFor(() => expect(announcer()).toHaveTextContent("«Agua» volvió a 3 de 8 vasos."));
  });

  test("quick taps each count (they never collapse): three taps send three deltas", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    await user.click(pad("Agua"));
    await user.click(pad("Agua"));
    expect(status("Agua")).toBe("6/8 VASOS");
    await server.answer();
    // Still right while the other two are in flight, on top of the server's answer.
    expect(status("Agua")).toBe("6/8 VASOS");
    await server.answerAll();
    expect(logHabit).toHaveBeenCalledTimes(3);
    expect(status("Agua")).toBe("6/8 VASOS");
  });

  test("the step is what a tap adds", async () => {
    const run = quantityHabit({ name: "Correr", goal: 30, target: 30, unit: "min", step: 5 });
    server.habits = [run];
    const user = userEvent.setup();
    render(<Harness />);
    expect(pad("Correr")).toHaveAccessibleDescription("0 de 30 min. Suma 5 cada vez.");
    await user.click(pad("Correr"));
    expect(logHabit).toHaveBeenCalledWith({ id: run.id, day: TODAY, delta: 5 });
    expect(status("Correr")).toBe("5/30 MIN");
  });

  test("varias veces al día: 1/2 → 2/2 reaches the goal (on, counted, celebrated)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(pad("Medicación")).not.toHaveClass("is-on");
    await user.click(pad("Medicación"));
    expect(status("Medicación")).toBe("2/2 VECES");
    expect(pad("Medicación")).toHaveClass("is-on");
    expect(count()).toBe("2 de 4 hoy");
    await server.answer();
    expect(within(notices()).getByText("Meta cumplida")).toBeVisible();
    expect(
      within(notices()).getByText("«Medicación»: 2 de 2 veces hoy. 2 de 4 hoy."),
    ).toBeVisible();
  });

  test("a refusal rolls back with a notice that says why", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    expect(status("Agua")).toBe("4/8 VASOS");
    await server.answer(fail(HABIT_ERRORS.archived));
    expect(within(notices()).getByText(`No se pudo sumar. ${HABIT_ERRORS.archived}`)).toBeVisible();
    // The notice can come before the rollback (CLAUDE.md "Optimistic rollback in tests").
    await waitFor(() => expect(status("Agua")).toBe("3/8 VASOS"));
  });

  test("a burst whose middle tap fails ends on the server's count, not the first one", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    await user.click(pad("Agua"));
    await user.click(pad("Agua"));
    expect(status("Agua")).toBe("6/8 VASOS");
    await server.answer();
    await server.answer(fail(HABIT_ERRORS.archived));
    await server.answer();
    // Only the failed tap is lost: 3 + 1 + 1.
    await waitFor(() => expect(status("Agua")).toBe("5/8 VASOS"));
    expect(within(notices()).getByText(`No se pudo sumar. ${HABIT_ERRORS.archived}`)).toBeVisible();
  });

  const steps = (quantity: number) =>
    quantityHabit({
      name: "Pasos",
      goal: 10_000,
      target: 10_000,
      unit: "pasos",
      step: 10_000,
      quantity,
    });

  test("at the 99 999 ceiling a tap adds nothing, so its notice offers no Deshacer", async () => {
    server.habits = [steps(99_999)];
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Pasos"));
    expect(status("Pasos")).toBe("99999/10000 PASOS");
    await server.answer();
    expect(
      within(notices()).getByText("«Pasos»: 99999 de 10000 pasos hoy. 1 de 1 hoy."),
    ).toBeVisible();
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  test("near the ceiling a tap adds what fits, and Deshacer takes back only that", async () => {
    const near = steps(95_000);
    server.habits = [near];
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Pasos"));
    expect(status("Pasos")).toBe("99999/10000 PASOS");
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(logHabit).toHaveBeenLastCalledWith({ id: near.id, day: TODAY, delta: -4_999 });
    expect(status("Pasos")).toBe("95000/10000 PASOS");
  });

  test("a network failure rolls back too", async () => {
    vi.mocked(logHabit).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    await waitFor(() => expect(status("Agua")).toBe("3/8 VASOS"));
    expect(within(notices()).getByText(/No se pudo sumar\. Revisa tu conexión/)).toBeVisible();
  });

  test("past Lima's midnight on an open page, a tap reloads instead of logging", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    vi.setSystemTime(new Date("2026-10-03T05:30:00.000Z"));
    await user.click(pad("Agua"));
    expect(logHabit).not.toHaveBeenCalled();
    expect(status("Agua")).toBe("3/8 VASOS");
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("a habit to avoid", () => {
  const slipKey = () => pad("Registrar recaída: No fumar");

  test("its pad: 'Registrar recaída: <name>', clean today, never red", () => {
    render(<Harness />);
    expect(slipKey()).toHaveAttribute("aria-pressed", "false");
    expect(slipKey()).toHaveAccessibleDescription("12 días limpio. Sin recaídas hoy.");
    expect(status("Registrar recaída: No fumar")).toBe("12 DÍAS LIMPIO");
    expect(slipKey().className).not.toMatch(/error|danger|red/);
  });

  test("one tap logs a relapse (no confirmation), Deshacer takes it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(slipKey());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(slipKey()).toHaveAttribute("aria-pressed", "true");
    expect(status("Registrar recaída: No fumar")).toBe("EMPIEZAS DE NUEVO HOY");
    expect(count()).toBe("0 de 4 hoy");
    expect(setHabitDone).toHaveBeenCalledWith({ id: FUMAR.id, day: TODAY, done: true });
    await server.answer();
    expect(within(notices()).getByText("Recaída registrada")).toBeVisible();
    expect(
      within(notices()).getByText(
        "Anotaste una recaída en «No fumar». Cada día es un nuevo comienzo. 0 de 4 hoy.",
      ),
    ).toBeVisible();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(slipKey()).toHaveAttribute("aria-pressed", "false");
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: FUMAR.id, day: TODAY, done: false });
    await server.answer();
    expect(count()).toBe("1 de 4 hoy");
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("«No fumar» volvió a quedar sin recaídas hoy."),
    );
  });

  test("a refused relapse rolls back (clean again, counted) with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(slipKey());
    expect(slipKey()).toHaveAttribute("aria-pressed", "true");
    await server.answer(fail(HABIT_ERRORS.archived));
    expect(
      within(notices()).getByText(`No se pudo registrar. ${HABIT_ERRORS.archived}`),
    ).toBeVisible();
    await waitFor(() => expect(slipKey()).toHaveAttribute("aria-pressed", "false"));
    expect(count()).toBe("1 de 4 hoy");
  });

  test("its options have no 'Ajustar el día' (a yes/no), nor does a yes/no's", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Opciones de «No fumar»" }));
    const dialog = await screen.findByRole("dialog", { name: "No fumar" });
    expect(within(dialog).queryByRole("button", { name: "Ajustar el día" })).toBeNull();
    // Positive control: the delete is there.
    expect(within(dialog).getByRole("button", { name: "Eliminar hábito" })).toBeVisible();
  });
});

describe("Ajustar el día", () => {
  async function openAdjust(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Opciones de «Agua»" }));
    const options = await screen.findByRole("dialog", { name: "Agua" });
    await user.click(within(options).getByRole("button", { name: "Ajustar el día" }));
    return screen.findByRole("dialog", { name: "Ajustar «Agua»" });
  }

  test("the day's quantity, −/+ by the step, saved as the exact value; Deshacer puts it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openAdjust(user);
    expect(sheet).toHaveAccessibleDescription("Meta del día: 8 vasos.");
    const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
    expect(field).toHaveValue("3");
    await waitFor(() => expect(field).toHaveFocus());
    await user.click(within(sheet).getByRole("button", { name: "Sumar 1" }));
    await user.click(within(sheet).getByRole("button", { name: "Sumar 1" }));
    expect(field).toHaveValue("5");
    await user.click(within(sheet).getByRole("button", { name: "Restar 1" }));
    expect(field).toHaveValue("4");
    await user.clear(field);
    await user.type(field, "6");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));

    expect(setHabitQuantity).toHaveBeenCalledWith({ id: AGUA.id, day: TODAY, quantity: 6 });
    expect(status("Agua")).toBe("6/8 VASOS");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Back to the key that opened the options.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Opciones de «Agua»" })).toHaveFocus(),
    );
    await server.answer();
    expect(within(notices()).getByText("«Agua» quedó en 6 de 8 vasos hoy.")).toBeVisible();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(setHabitQuantity).toHaveBeenLastCalledWith({ id: AGUA.id, day: TODAY, quantity: 3 });
    expect(status("Agua")).toBe("3/8 VASOS");
    await server.answer();
    await waitFor(() => expect(announcer()).toHaveTextContent("«Agua» quedó en 3 de 8 vasos hoy."));
  });

  test("never below 0 with −; a value that isn't 0–99 999 says so and saves nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openAdjust(user);
    const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
    await user.clear(field);
    await user.type(field, "0");
    await user.click(within(sheet).getByRole("button", { name: "Restar 1" }));
    expect(field).toHaveValue("0");
    for (const typed of ["-2", "2,5", "100000", "tres"]) {
      await user.clear(field);
      await user.type(field, typed);
      await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
      expect(field).toHaveAccessibleDescription(MEASURE_ERRORS.quantityInvalid);
      expect(field).toHaveFocus();
    }
    await user.clear(field);
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(field).toHaveAccessibleDescription(MEASURE_ERRORS.quantityInvalid);
    expect(setHabitQuantity).not.toHaveBeenCalled();
    // Positive control: a valid value saves.
    await user.type(field, "99999");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitQuantity).toHaveBeenCalledWith({ id: AGUA.id, day: TODAY, quantity: 99_999 });
  });

  test("−/+ say the new value; the arrow keys nudge like a spin button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openAdjust(user);
    const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
    await user.click(within(sheet).getByRole("button", { name: "Sumar 1" }));
    expect(within(sheet).getByRole("status")).toHaveTextContent("4 vasos");
    await user.click(field);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(field).toHaveValue("2");
    expect(within(sheet).getByRole("status")).toHaveTextContent("2 vasos");
    await user.keyboard("{ArrowUp}");
    expect(field).toHaveValue("3");
  });

  test("two adjusts before the first is saved: only the newer is sent after it; Deshacer goes back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const typed of ["6", "7"]) {
      const sheet = await openAdjust(user);
      const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
      await user.clear(field);
      await user.type(field, typed);
      await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    expect(status("Agua")).toBe("7/8 VASOS");
    await server.answerAll();
    expect(setHabitQuantity).toHaveBeenLastCalledWith({ id: AGUA.id, day: TODAY, quantity: 7 });
    expect(status("Agua")).toBe("7/8 VASOS");
    // Only the newer speaks; its Deshacer returns to what was there before it (6).
    expect(within(notices()).getAllByText(/«Agua» quedó en/)).toHaveLength(1);
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(setHabitQuantity).toHaveBeenLastCalledWith({ id: AGUA.id, day: TODAY, quantity: 6 });
  });

  test("the same value saves nothing; Cancelar neither", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    let sheet = await openAdjust(user);
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    sheet = await openAdjust(user);
    await user.click(within(sheet).getByRole("button", { name: "Sumar 1" }));
    await user.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setHabitQuantity).not.toHaveBeenCalled();
    expect(status("Agua")).toBe("3/8 VASOS");
  });

  test("a refused adjust rolls back with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openAdjust(user);
    const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
    await user.clear(field);
    await user.type(field, "7");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(status("Agua")).toBe("7/8 VASOS");
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(
      within(notices()).getByText(`No se pudo ajustar. ${HABIT_ERRORS.notFound}`),
    ).toBeVisible();
    await waitFor(() => expect(status("Agua")).toBe("3/8 VASOS"));
  });
});

describe("create: Tipo y Medición", () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    return screen.findByRole("dialog", { name: "Nuevo hábito" });
  }

  function created(values: Partial<HabitItem>) {
    const item = habit(values);
    vi.mocked(createHabit).mockResolvedValueOnce(ok(item));
    return item;
  }

  test("Cantidad: goal, unit and step, with the live summary", async () => {
    created({ name: "Agua 2" });
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    const kind = within(dialog).getByRole("radiogroup", { name: "Tipo" });
    expect(within(kind).getByRole("radio", { name: "A cumplir" })).toBeChecked();
    const measure = within(dialog).getByRole("radiogroup", { name: "Medición" });
    expect(within(measure).getByRole("radio", { name: "Sí/No" })).toBeChecked();
    expect(within(dialog).queryByRole("textbox", { name: "Meta del día" })).toBeNull();

    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Agua 2");
    await user.click(within(measure).getByRole("radio", { name: "Cantidad" }));
    expect(within(dialog).getByText("Cada día · … …")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Meta del día" }), "8");
    await user.type(within(dialog).getByRole("textbox", { name: "Unidad" }), "vasos");
    expect(within(dialog).getByRole("textbox", { name: "Paso" })).toHaveValue("1");
    expect(within(dialog).getByText("Cada día · 8 vasos")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith({
      name: "Agua 2",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      kind: "build",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
      step: 1,
    });
  });

  test("a missing goal and unit are said on their fields, focus on the first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Agua 2");
    await user.click(within(dialog).getByRole("radio", { name: "Cantidad" }));
    const step = within(dialog).getByRole("textbox", { name: "Paso" });
    await user.clear(step);
    await user.type(step, "3");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    const goal = within(dialog).getByRole("textbox", { name: "Meta del día" });
    expect(goal).toHaveAccessibleDescription(MEASURE_ERRORS.goalRequired);
    expect(within(dialog).getByRole("textbox", { name: "Unidad" })).toHaveAccessibleDescription(
      MEASURE_ERRORS.unitRequired,
    );
    await waitFor(() => expect(goal).toHaveFocus());
    expect(createHabit).not.toHaveBeenCalled();

    // A step bigger than the goal is said on the step.
    await user.type(goal, "2");
    await user.type(within(dialog).getByRole("textbox", { name: "Unidad" }), "vasos");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(step).toHaveAccessibleDescription(MEASURE_ERRORS.stepTooBig);
    await waitFor(() => expect(step).toHaveFocus());
    expect(createHabit).not.toHaveBeenCalled();
  });

  test("'Varias veces al día' fills a daily quantity in veces, goal 2, step 1", async () => {
    created({ name: "Medicación 2" });
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Medicación 2");
    await user.click(within(dialog).getByRole("button", { name: "Varias veces al día" }));
    expect(within(dialog).getByRole("radio", { name: "Cantidad" })).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "Unidad" })).toHaveValue("veces");
    expect(within(dialog).getByRole("textbox", { name: "Paso" })).toHaveValue("1");
    const goal = within(dialog).getByRole("textbox", { name: "Meta del día" });
    expect(goal).toHaveValue("2");
    expect(within(dialog).getByText("Cada día · 2 veces")).toBeInTheDocument();
    await user.clear(goal);
    await user.type(goal, "3");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith({
      name: "Medicación 2",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      kind: "build",
      measure: "quantity",
      goal: 3,
      unit: "veces",
      step: 1,
    });
  });

  test("A evitar: a yes/no, every day (no Medición to pick)", async () => {
    created({ name: "No comer azúcar", kind: "avoid" });
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "No comer azúcar");
    // Even with a quantity picked before.
    await user.click(within(dialog).getByRole("radio", { name: "Cantidad" }));
    await user.click(within(dialog).getByRole("radio", { name: "A evitar" }));
    expect(within(dialog).queryByRole("radiogroup", { name: "Medición" })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "Meta del día" })).toBeNull();
    expect(within(dialog).getByText(/Un hábito a evitar se registra con sí o no/)).toBeVisible();
    expect(within(dialog).getByText("Cada día · A evitar")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith({
      name: "No comer azúcar",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      kind: "avoid",
      measure: "check",
    });
  });
});

describe("the form with H2's frequency", () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    return screen.findByRole("dialog", { name: "Nuevo hábito" });
  }

  test("'Varias veces al día' makes a weekly draft daily again", async () => {
    vi.mocked(createHabit).mockResolvedValueOnce(ok(habit({ name: "Gotas" })));
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Gotas");
    const frequency = within(dialog).getByRole("radiogroup", { name: "Frecuencia" });
    await user.click(within(frequency).getByRole("radio", { name: "Por semana" }));
    await user.click(within(dialog).getByRole("button", { name: "Varias veces al día" }));
    expect(within(frequency).getByRole("radio", { name: "Diaria" })).toBeChecked();
    expect(within(dialog).getByText("Cada día · 2 veces")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: "daily", measure: "quantity", goal: 2 }),
    );
  });

  test("A evitar hides the frequency and sends it daily, whatever was picked", async () => {
    vi.mocked(createHabit).mockResolvedValueOnce(ok(habit({ name: "No azúcar", kind: "avoid" })));
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "No azúcar");
    await user.click(within(dialog).getByRole("radio", { name: "Días fijos" }));
    await user.click(within(dialog).getByRole("radio", { name: "A evitar" }));
    expect(within(dialog).queryByRole("radiogroup", { name: "Frecuencia" })).toBeNull();
    // Positive control: back to "A cumplir", the frequency is there again (as it was left).
    await user.click(within(dialog).getByRole("radio", { name: "A cumplir" }));
    expect(within(dialog).getByRole("radio", { name: "Días fijos" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "A evitar" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "avoid", frequency: "daily", weekdays: null }),
    );
  });

  test("Editar a quantity: goal, step and unit (kind and measure fixed), the goal from today", async () => {
    vi.mocked(updateHabit)
      .mockReset()
      .mockResolvedValueOnce(ok({ ...AGUA, goal: 10, target: 10 }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Opciones de «Agua»" }));
    const options = await screen.findByRole("dialog", { name: "Agua" });
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    expect(within(dialog).queryByRole("radiogroup", { name: "Tipo" })).toBeNull();
    expect(within(dialog).queryByRole("radiogroup", { name: "Medición" })).toBeNull();
    const goal = within(dialog).getByRole("textbox", { name: "Meta del día" });
    expect(goal).toHaveValue("8");
    expect(goal).toHaveAccessibleDescription(
      "Cuenta desde hoy: los días pasados conservan su meta.",
    );
    expect(within(dialog).getByRole("textbox", { name: "Unidad" })).toHaveValue("vasos");
    await user.clear(goal);
    await user.type(goal, "10");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).toHaveBeenCalledWith({
      id: AGUA.id,
      name: "Agua",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      goal: 10,
      unit: "vasos",
      step: 1,
    });
  });

  test("Editar a habit to avoid: no frequency nor measure to change, none sent", async () => {
    vi.mocked(updateHabit).mockReset().mockResolvedValueOnce(ok(FUMAR));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Opciones de «No fumar»" }));
    const options = await screen.findByRole("dialog", { name: "No fumar" });
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    expect(within(dialog).getByText(/Un hábito a evitar se registra con sí o no/)).toBeVisible();
    expect(within(dialog).queryByRole("radiogroup", { name: "Frecuencia" })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "Meta del día" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).toHaveBeenCalledWith({
      id: FUMAR.id,
      name: "No fumar",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
    });
  });
});
