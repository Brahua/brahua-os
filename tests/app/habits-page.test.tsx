// H1 of `habits`: /habits "Hoy" (the pads, one-tap logging with Deshacer, the live count, the
// empty state), creating a habit and deleting one, against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HabitsPage, { metadata } from "@/app/(app)/habits/page";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import { createHabit, deleteHabit, restoreHabit } from "@/modules/habits/actions";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { HABIT_ERRORS, type HabitAreaSummary, type HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import { listActiveHabits } from "@/modules/habits/queries";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/core/queries", () => ({ listLifeAreas: vi.fn() }));
vi.mock("@/modules/habits/queries", () => ({ listActiveHabits: vi.fn() }));
vi.mock("@/modules/habits/actions", () => ({
  createHabit: vi.fn(),
  deleteHabit: vi.fn(),
  restoreHabit: vi.fn(),
}));
vi.mock("@/modules/habits/log-actions", () => ({ setHabitDone: vi.fn() }));

const TODAY = "2026-10-02";

const HEALTH: HabitAreaSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "health",
  name: "Salud",
  icon: "heart-pulse",
  color: "health",
};
const AREAS = [HEALTH];

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
    ...values,
  };
}

const MEDITAR = habit({ name: "Meditar", area: HEALTH });
const LEER = habit({ name: "Leer", quantity: 1, hasLogs: true });
const AGUA = habit({ name: "Tomar agua" });
const HABITS = [MEDITAR, LEER, AGUA];

/**
 * A fake server: each action waits until the test answers it (in order), then applies the change
 * and re-renders the list with it, like the revalidation. Every call must settle before the test
 * ends (React entangles pending async transitions).
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

function serverCall<T>(
  apply: (habits: HabitItem[]) => HabitItem[],
  value: () => T,
): Promise<ActionResult<T>> {
  return new Promise((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.habits = apply(server.habits);
          server.render(server.habits);
        }
        resolve((result as ActionResult<T>) ?? ok(value()));
      },
    });
  });
}

const deleted = new Map<string, HabitItem>();

function Harness() {
  const [habits, setHabits] = useState(server.habits);
  useLayoutEffect(() => {
    server.render = setHabits;
  }, []);
  return (
    <HabitsScreen today={TODAY} areas={AREAS}>
      <HabitsToday habits={habits} headingId="habits-title" />
    </HabitsScreen>
  );
}

let desktop = false;
beforeEach(() => {
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.habits = HABITS;
  server.pending = [];
  deleted.clear();
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(listActiveHabits).mockReset().mockResolvedValue(HABITS);
  vi.mocked(listLifeAreas)
    .mockReset()
    .mockResolvedValue(AREAS.map((area) => ({ ...area, sortOrder: 0 })));
  const byId = (id: string) => server.habits.find((item) => item.id === id)!;
  vi.mocked(setHabitDone)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, done } = input as { id: string; done: boolean };
      const change = (item: HabitItem): HabitItem => ({
        ...item,
        quantity: done ? 1 : 0,
        hasLogs: item.hasLogs || done,
      });
      return serverCall(
        (habits) => habits.map((item) => (item.id === id ? change(item) : item)),
        () => byId(id),
      );
    });
  vi.mocked(deleteHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      const found = byId(id);
      return serverCall(
        (habits) => {
          deleted.set(id, found);
          return habits.filter((item) => item.id !== id);
        },
        () => ({ id, name: found.name }),
      );
    });
  vi.mocked(restoreHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      const back = deleted.get(id)!;
      return serverCall(
        (habits) => HABITS.filter((item) => item.id === id || habits.includes(item)),
        () => back,
      );
    });
  vi.mocked(createHabit).mockReset();
});

afterEach(async () => {
  await server.answerAll();
});

/** A pad by its exact name (a string name matches the whole accessible name). */
const pad = (name: string) => screen.getByRole("button", { name });
/** The pads' names, in order (the last line of each pad; the status line is decorative). */
const padNames = () =>
  [
    ...screen
      .getByRole("list", { name: "Hábitos de hoy" })
      .querySelectorAll<HTMLElement>("[data-habit-pad]"),
  ].map((button) => button.lastElementChild?.textContent);
const count = () => document.querySelector("[data-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-habits-announcer]");

describe("/habits", () => {
  test("title, owner check, today's pads in their order and the live count", async () => {
    expect(metadata.title).toBe("Hábitos · brahua-os");
    render(await HabitsPage());
    expect(requireOwner).toHaveBeenCalled();
    expect(listActiveHabits).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Hábitos" })).toBeInTheDocument();
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]);
    // A toggle per habit: pressed is done today.
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false");
    expect(pad("Leer")).toHaveAttribute("aria-pressed", "true");
    expect(count()).toBe("1 de 3 hoy");
    // Its options are a separate key (never a control inside the pad).
    expect(screen.getByRole("button", { name: "Opciones de «Meditar»" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });

  test("empty: an explanation and a key to create the first one; no count", async () => {
    vi.mocked(listActiveHabits).mockResolvedValue([]);
    render(await HabitsPage());
    expect(screen.getByRole("heading", { level: 2, name: "Todavía no tienes hábitos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Crear un hábito" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Hábitos de hoy" })).not.toBeInTheDocument();
    expect(count()).toBeUndefined();
  });
});

describe("one tap", () => {
  test("marks today at once (count too), sends the state wanted; Deshacer unmarks it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    // Before the server answers.
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    expect(count()).toBe("2 de 3 hoy");
    expect(setHabitDone).toHaveBeenCalledWith({ id: MEDITAR.id, day: TODAY, done: true });
    expect(pad("Meditar")).toHaveFocus();

    await server.answer();
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    expect(within(notices()).getByText("«Meditar» quedó hecho hoy.")).toBeInTheDocument();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false");
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: MEDITAR.id, day: TODAY, done: false });
    await server.answer();
    expect(count()).toBe("1 de 3 hoy");
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("«Meditar» volvió a quedar sin marcar."),
    );
  });

  test("a done pad unmarks with one tap (it is a toggle), with Deshacer too", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Leer"));
    expect(pad("Leer")).toHaveAttribute("aria-pressed", "false");
    expect(setHabitDone).toHaveBeenCalledWith({ id: LEER.id, day: TODAY, done: false });
    await server.answer();
    expect(within(notices()).getByText("«Leer» quedó sin marcar hoy.")).toBeInTheDocument();
    expect(count()).toBe("0 de 3 hoy");
  });

  test("two quick taps: only the last state is sent after the one in flight", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Tomar agua"));
    await user.click(pad("Tomar agua"));
    await user.click(pad("Tomar agua"));
    expect(pad("Tomar agua")).toHaveAttribute("aria-pressed", "true");
    // The first is in flight; the second is skipped (a newer one with the same key came).
    await server.answer();
    await server.answer();
    expect(setHabitDone).toHaveBeenCalledTimes(2);
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: AGUA.id, day: TODAY, done: true });
    expect(pad("Tomar agua")).toHaveAttribute("aria-pressed", "true");
  });

  test("a refusal rolls back with a notice that says why", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false");
    expect(count()).toBe("1 de 3 hoy");
    expect(
      within(notices()).getByText(`No se pudo registrar. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
  });

  test("a network failure rolls back too", async () => {
    vi.mocked(setHabitDone).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    await waitFor(() => expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false"));
    expect(within(notices()).getByText(/No se pudo registrar\. Revisa tu conexión/)).toBeVisible();
  });
});

describe("delete", () => {
  async function openOptions(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
    return screen.findByRole("dialog", { name });
  }

  test("without logs: out at once (focus to the next pad), Deshacer brings it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Meditar");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    expect(padNames()).toEqual(["Leer", "Tomar agua"]);
    expect(deleteHabit).toHaveBeenCalledWith({ id: MEDITAR.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(pad("Leer")).toHaveFocus());
    await server.answer();
    expect(within(notices()).getByText("«Meditar» se eliminó.")).toBeInTheDocument();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]);
    expect(restoreHabit).toHaveBeenCalledWith({ id: MEDITAR.id });
    await server.answer();
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]);
    await waitFor(() => expect(announcer()).toHaveTextContent("«Meditar» volvió."));
  });

  test("with logs it asks first; 'No, conservarlo' keeps it and sends nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Leer");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    const title = within(dialog).getByRole("heading", { name: "¿Eliminar «Leer»?" });
    expect(title).toHaveFocus();
    expect(deleteHabit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "No, conservarlo" }));
    expect(within(dialog).getByRole("button", { name: "Eliminar hábito" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));
    expect(deleteHabit).toHaveBeenCalledWith({ id: LEER.id });
    expect(padNames()).toEqual(["Meditar", "Tomar agua"]);
    await server.answer();
  });

  test("the last pad leaving sends focus to the heading; the empty state shows", async () => {
    server.habits = [AGUA];
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Tomar agua");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    expect(screen.getByRole("heading", { name: "Todavía no tienes hábitos" })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Hábitos" })).toHaveFocus(),
    );
    await server.answer();
  });

  test("a refused delete brings the pad back with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Meditar");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]);
    expect(
      within(notices()).getByText(`No se pudo eliminar. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
  });
});

describe("create", () => {
  test("name and area; the new pad gets focus and it is announced", async () => {
    const created = habit({ name: "Estirar", area: HEALTH });
    let answer: () => void = () => {};
    vi.mocked(createHabit).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => {
            server.habits = [...server.habits, created];
            server.render(server.habits);
            resolve(ok(created));
          };
        }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    const name = within(dialog).getByRole("textbox", { name: "Nombre" });
    expect(name).toHaveFocus();
    // Every new habit is a daily yes/no (H1); the summary says it.
    expect(within(dialog).getByText("Cada día · Sí o no")).toBeInTheDocument();
    const areas = within(dialog).getByRole("radiogroup", { name: "Área (opcional)" });
    expect(within(areas).getByRole("radio", { name: "Sin área" })).toBeChecked();
    await user.type(name, "  Estirar ");
    await user.click(within(areas).getByRole("radio", { name: "Salud" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith({ name: "Estirar", lifeAreaId: HEALTH.id });
    // While it waits, the sheet stays open and says so.
    expect(within(dialog).getByRole("button", { name: "Creando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await act(async () => answer());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(pad("Estirar")).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("Hábito «Estirar» creado."));
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua", "Estirar"]);
    expect(count()).toBe("1 de 4 hoy");
  });

  test("an empty name stays in the field with its error and sends nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    const name = within(dialog).getByRole("textbox", { name: "Nombre" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(expect.stringContaining(HABIT_ERRORS.nameRequired));
    expect(name).toHaveFocus();
    expect(createHabit).not.toHaveBeenCalled();
  });

  test("an area archived meanwhile: the error goes on the area picker", async () => {
    vi.mocked(createHabit).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [HABIT_ERRORS.areaUnavailable] },
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Estirar");
    await user.click(within(dialog).getByRole("radio", { name: "Salud" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(await within(dialog).findByText(HABIT_ERRORS.areaUnavailable)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Salud" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Nuevo hábito" })).toBeVisible();
  });

  test("Cancelar closes it and focus goes back to the key", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const key = screen.getByRole("button", { name: "Nuevo hábito" });
    await user.click(key);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(key).toHaveFocus();
    expect(createHabit).not.toHaveBeenCalled();
  });
});
