// H1 of `habits`: /habits "Hoy" (the pads, one-tap logging with Deshacer, the live count, the
// empty state), creating a habit and deleting one, against a fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import HabitsPage, { metadata } from "@/app/(app)/habits/page";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import { createHabit, deleteHabit, restoreHabit } from "@/modules/habits/actions";
import { ScreenServicesContext } from "@/modules/core/components/screen-services";
import { HabitsScreen, HabitsScreenWithin } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { HABIT_ERRORS, type HabitAreaSummary, type HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import { listActiveHabits } from "@/modules/habits/queries";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
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
/** 10:00 in Lima on TODAY. Only Date is faked (timers stay real for userEvent). */
const NOW = new Date("2026-10-02T15:00:00.000Z");

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  router.refresh.mockReset();
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
        hasLogs: true,
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
        // Back in its place (the server keeps its sort order), the others as they are now.
        (habits) => {
          const ids = new Set([...habits.map((item) => item.id), id]);
          const current = new Map([...habits, back].map((item) => [item.id, item]));
          return HABITS.filter((item) => ids.has(item.id)).map((item) => current.get(item.id)!);
        },
        () => back,
      );
    });
  vi.mocked(createHabit).mockReset();
});

afterEach(async () => {
  await server.answerAll();
  vi.useRealTimers();
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
    expect(
      screen.getByRole("heading", { level: 2, name: "Todavía no tienes hábitos" }),
    ).toBeVisible();
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
    expect(
      within(notices()).getByText("«Meditar» quedó hecho hoy. 2 de 3 hoy."),
    ).toBeInTheDocument();

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
    expect(
      within(notices()).getByText("«Leer» quedó sin marcar hoy. 0 de 3 hoy."),
    ).toBeInTheDocument();
    expect(count()).toBe("0 de 3 hoy");
  });

  test("three quick taps: only the last state is sent after the one in flight; one notice", async () => {
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
    // Only the last one speaks (the one in flight was superseded).
    expect(within(notices()).getAllByText(/«Tomar agua» quedó/)).toHaveLength(1);
  });

  test("the pad: HECHO (decorative) when done, the area as its description", async () => {
    render(<Harness />);
    const status = (name: string) => pad(name).querySelector(".bo-key__sub");
    expect(status("Leer")).toHaveTextContent("HECHO");
    expect(status("Leer")).toHaveAttribute("aria-hidden", "true");
    expect(status("Meditar")).toHaveTextContent("");
    expect(pad("Meditar")).toHaveAccessibleDescription("Área: Salud");
    expect(pad("Leer")).not.toHaveAttribute("aria-describedby");
  });

  test("a refused Deshacer leaves the pad as the tap left it, with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false");
    await server.answer(fail(HABIT_ERRORS.archived));
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(notices()).getByText(`No se pudo deshacer. ${HABIT_ERRORS.archived}`),
    ).toBeInTheDocument();
  });

  test("past Lima's midnight on an open page, a tap reloads instead of logging yesterday", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // 00:30 in Lima on the 3rd; the page was read on the 2nd.
    vi.setSystemTime(new Date("2026-10-03T05:30:00.000Z"));
    await user.click(pad("Meditar"));
    expect(setHabitDone).not.toHaveBeenCalled();
    expect(pad("Meditar")).toHaveAttribute("aria-pressed", "false");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Empezó un nuevo día: actualizando tus hábitos."),
    );
    // A second tap doesn't refresh again for the same day.
    await user.click(pad("Meditar"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test("becoming visible on a new day refreshes the page; the same day doesn't", async () => {
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    onTestFinished(() => visible.mockRestore());
    render(<Harness />);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(router.refresh).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-03T05:00:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test("23:30 in Lima is still the same day: the page logs it, not UTC's next one", async () => {
    vi.setSystemTime(new Date("2026-10-03T04:30:00.000Z"));
    const user = userEvent.setup();
    render(await HabitsPage());
    expect(vi.mocked(listActiveHabits).mock.calls[0][0]).toEqual(
      new Date("2026-10-03T04:30:00.000Z"),
    );
    await user.click(pad("Meditar"));
    expect(setHabitDone).toHaveBeenCalledWith({ id: MEDITAR.id, day: "2026-10-02", done: true });
    await server.answer();
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

  test("a habit tapped just now has logs: deleting it asks first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    await server.answer();
    const dialog = await openOptions(user, "Meditar");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    expect(within(dialog).getByRole("heading", { name: "¿Eliminar «Meditar»?" })).toHaveFocus();
    expect(deleteHabit).not.toHaveBeenCalled();
  });

  test("Esc closes the options and focus goes back to their key", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openOptions(user, "Leer");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Opciones de «Leer»" })).toHaveFocus();
  });

  test("a delete lost to the network brings the pad back with a notice", async () => {
    vi.mocked(deleteHabit).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Meditar");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    await waitFor(() => expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]));
    expect(within(notices()).getByText(/No se pudo eliminar\. Revisa tu conexión/)).toBeVisible();
  });

  test("a refused restore takes the pad out again, with a notice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOptions(user, "Meditar");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar hábito" }));
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(padNames()).toEqual(["Meditar", "Leer", "Tomar agua"]);
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(padNames()).toEqual(["Leer", "Tomar agua"]);
    expect(
      within(notices()).getByText(`No se pudo deshacer. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
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

  test("while it creates: no second submit, and Esc or Cancelar don't close it", async () => {
    let answer: () => void = () => {};
    const created = habit({ name: "Estirar" });
    vi.mocked(createHabit).mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve(ok(created)))),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    const name = within(dialog).getByRole("textbox", { name: "Nombre" });
    await user.type(name, "Estirar{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Creando…" }));
    await user.type(name, "{Enter}");
    expect(createHabit).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Nuevo hábito" })).toBeVisible();
    // E2E waits for this marker before measuring.
    expect(dialog.querySelector("form")).toHaveAttribute("data-saving");
    await act(async () => answer());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("a create lost to the network: the general error, the sheet stays open", async () => {
    vi.mocked(createHabit).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Estirar{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo guardar. Revisa tu conexión",
    );
    expect(screen.getByRole("dialog", { name: "Nuevo hábito" })).toBeVisible();
  });

  test("from the empty state: the key leaves, so focus waits on the heading for the new pad", async () => {
    server.habits = [];
    const created = habit({ name: "Primero" });
    let answer: () => void = () => {};
    vi.mocked(createHabit).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(ok(created));
        }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Crear un hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Primero{Enter}");
    // The server answers before its revalidation reaches the page.
    await act(async () => answer());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Hábitos" })).toHaveFocus(),
    );
    // The revalidation lands: focus moves to the new pad.
    act(() => server.render([created]));
    await waitFor(() => expect(pad("Primero")).toHaveFocus());
  });
});

describe("the context", () => {
  test("useHabitsScreen outside a habits screen is an error", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => silence.mockRestore());
    expect(() => render(<HabitsToday habits={[]} headingId="x" />)).toThrow(
      "useHabitsScreen must be used inside HabitsScreen",
    );
  });

  test("HabitsScreenWithin uses the host screen's queue, notices and announcer (H6)", async () => {
    const push = vi.fn();
    const announce = vi.fn();
    const services = {
      enqueue: (async (_key: string | null, call: () => Promise<unknown>) => ({
        kind: "done",
        value: await call(),
        superseded: false,
      })) as never,
      toaster: {
        state: { visible: null, queue: [], serial: 0 },
        push,
        replace: vi.fn(),
        dismiss: vi.fn(),
      },
      announce,
    };
    const user = userEvent.setup();
    render(
      <ScreenServicesContext value={services}>
        <HabitsScreenWithin today={TODAY} areas={AREAS}>
          <HabitsToday habits={[MEDITAR]} headingId="x" />
        </HabitsScreenWithin>
      </ScreenServicesContext>,
    );
    await user.click(pad("Meditar"));
    await server.answer();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ text: "«Meditar» quedó hecho hoy. 1 de 1 hoy." }),
      ),
    );
    // No viewport of its own: the host's.
    expect(screen.queryByRole("region", { name: "Avisos" })).not.toBeInTheDocument();
  });
});
