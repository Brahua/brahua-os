// H2 of `habits` on /habits "Hoy": what is due today ("Nada toca hoy", "No tocan hoy"), the week
// of a weekly habit, the frequency in the form, edit, archive and reactivate, and the manual
// order, against a fake server (like tests/app/habits-page.test.tsx).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createHabit } from "@/modules/habits/actions";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { ArchivedHabitsSection } from "@/modules/habits/components/archived-habits-section";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { FREQUENCY_ERRORS } from "@/modules/habits/frequency-copy";
import { HABIT_ERRORS, type HabitAreaSummary, type HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import {
  archiveHabit,
  reorderHabits,
  unarchiveHabit,
  updateHabit,
} from "@/modules/habits/organize-actions";
import { ORGANIZE_ERRORS } from "@/modules/habits/organize-copy";

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
vi.mock("@/modules/habits/log-actions", () => ({ setHabitDone: vi.fn() }));
vi.mock("@/modules/habits/organize-actions", () => ({
  updateHabit: vi.fn(),
  reorderHabits: vi.fn(),
  archiveHabit: vi.fn(),
  unarchiveHabit: vi.fn(),
}));

/** A Friday (ISO 5). */
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
/** An area archived since its habit got it (not offered to new habits). */
const OLD_AREA: HabitAreaSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "old",
  name: "Antigua",
  icon: "house",
  color: "home",
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

const MEDITAR = habit({ name: "Meditar", area: HEALTH });
/** Mondays and Wednesdays: not due on a Friday. */
const INGLES = habit({ name: "Inglés", frequency: "weekdays", weekdays: [1, 3] });
/** 3 a week, one day done before today. */
const GYM = habit({
  name: "Gimnasio",
  frequency: "weekly_count",
  weeklyTarget: 3,
  weekDoneBefore: 1,
});
const HABITS = [MEDITAR, INGLES, GYM];

type Data = { habits: HabitItem[]; archived: HabitItem[] };

/**
 * A fake server: each action waits until the test answers it (in order), then applies the change
 * and re-renders the page with it, like the revalidation. Every call must settle before the test
 * ends (React entangles pending async transitions).
 */
const server = {
  data: { habits: HABITS, archived: [] } as Data,
  render: (() => {}) as (data: Data) => void,
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

function serverCall<T>(apply: (data: Data) => Data, value: () => T): Promise<ActionResult<T>> {
  return new Promise((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.data = apply(server.data);
          server.render(server.data);
        }
        resolve((result as ActionResult<T>) ?? ok(value()));
      },
    });
  });
}

const find = (id: string) =>
  [...server.data.habits, ...server.data.archived].find((item) => item.id === id)!;

function Harness() {
  const [data, setData] = useState(server.data);
  useLayoutEffect(() => {
    server.render = setData;
  }, []);
  return (
    <HabitsScreen today={TODAY} areas={AREAS}>
      <HabitsToday habits={data.habits} headingId="habits-title" />
      {/* H5: "Archivados" is in "Semana"; both read the same data here. */}
      <ArchivedHabitsSection habits={data.archived} headingId="habits-title" />
    </HabitsScreen>
  );
}

function renderPage(data: Partial<Data> = {}) {
  server.data = { habits: HABITS, archived: [], ...data };
  return render(<Harness />);
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
  server.pending = [];
  vi.mocked(setHabitDone)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, done } = input as { id: string; done: boolean };
      return serverCall(
        (data) => ({
          ...data,
          habits: data.habits.map((item) =>
            item.id === id ? { ...item, quantity: done ? 1 : 0, hasLogs: true } : item,
          ),
        }),
        () => find(id),
      );
    });
  vi.mocked(updateHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, ...changes } = input as HabitItem;
      return serverCall(
        (data) => ({
          ...data,
          habits: data.habits.map((item) => (item.id === id ? { ...item, ...changes } : item)),
        }),
        () => find(id),
      );
    });
  vi.mocked(reorderHabits)
    .mockReset()
    .mockImplementation(async (input) => {
      const { ids } = input as { ids: string[] };
      return serverCall(
        (data) => ({
          ...data,
          habits: ids.map((id) => data.habits.find((item) => item.id === id)!),
        }),
        () => null,
      );
    });
  vi.mocked(archiveHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverCall(
        (data) => ({
          habits: data.habits.filter((item) => item.id !== id),
          archived: [find(id), ...data.archived.filter((item) => item.id !== id)],
        }),
        () => find(id),
      );
    });
  vi.mocked(unarchiveHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, position } = input as { id: string; position: "end" | "original" };
      return serverCall(
        (data) => {
          const back = find(id);
          const rest = data.habits.filter((item) => item.id !== id);
          // "original": its place in HABITS among the others; "end": last.
          const habits =
            position === "end"
              ? [...rest, back]
              : HABITS.filter((item) => item.id === id || rest.some((r) => r.id === item.id)).map(
                  (item) => (item.id === id ? back : rest.find((r) => r.id === item.id)!),
                );
          return { habits, archived: data.archived.filter((item) => item.id !== id) };
        },
        () => find(id),
      );
    });
  vi.mocked(createHabit).mockReset();
});

afterEach(async () => {
  await server.answerAll();
  vi.useRealTimers();
});

const grid = (name: "due" | "not-due") =>
  document.querySelector<HTMLElement>(`[data-habits-grid="${name}"]`);
/** The pads' names in a grid, in order. */
const padNames = (name: "due" | "not-due" = "due") =>
  [...(grid(name)?.querySelectorAll<HTMLElement>("[data-habit-pad]") ?? [])].map(
    (button) => button.querySelector(".line-clamp-3")?.textContent,
  );
const pad = (name: string) => screen.getByRole("button", { name });
const count = () => document.querySelector("[data-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-habits-announcer]");

async function openOptions(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
  return screen.findByRole("dialog", { name });
}

describe("what is due today", () => {
  test("fixed days of other days go to the folded 'No tocan hoy (N)'; they log today too", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(padNames()).toEqual(["Meditar", "Gimnasio"]);
    // Only the habits due today count.
    expect(count()).toBe("0 de 2 hoy");
    const toggle = screen.getByRole("button", { name: /No tocan hoy/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("1");
    expect(within(grid("not-due")!).queryByRole("button", { name: "Inglés" })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(padNames("not-due")).toEqual(["Inglés"]);
    await user.click(pad("Inglés"));
    expect(setHabitDone).toHaveBeenCalledWith({ id: INGLES.id, day: TODAY, done: true });
    expect(pad("Inglés")).toHaveAttribute("aria-pressed", "true");
    // Not due: the count doesn't change (before and after the server answers).
    expect(count()).toBe("0 de 2 hoy");
    await server.answer();
    expect(count()).toBe("0 de 2 hoy");
    expect(pad("Inglés")).toHaveAttribute("aria-pressed", "true");
  });

  test("habits, but none due today: 'Nada toca hoy' (not the empty state)", () => {
    renderPage({ habits: [INGLES] });
    expect(screen.getByText("Nada toca hoy")).toBeVisible();
    expect(screen.queryByText("Todavía no tienes hábitos")).not.toBeInTheDocument();
    expect(count()).toBeUndefined();
    expect(screen.getByRole("button", { name: /No tocan hoy/ })).toBeInTheDocument();
  });

  test("without fixed days of other days, neither 'Nada toca hoy' nor the section", () => {
    renderPage({ habits: [MEDITAR, GYM] });
    expect(screen.queryByText("Nada toca hoy")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /No tocan hoy/ })).not.toBeInTheDocument();
  });

  test("a weekly habit: '1 de 3 esta semana', and a tap makes it 2 (the count says done once met)", async () => {
    const user = userEvent.setup();
    renderPage();
    const week = () => pad("Gimnasio").querySelector("[data-habit-week]");
    expect(week()).toHaveTextContent("1 de 3 esta semana");
    expect(week()).toHaveAttribute("aria-hidden", "true");
    expect(pad("Gimnasio")).toHaveAccessibleDescription("1 de 3 esta semana");
    expect(pad("Meditar")).toHaveAccessibleDescription("Área: Salud");
    expect(pad("Meditar").querySelector("[data-habit-week]")).toBeNull();
    await user.click(pad("Gimnasio"));
    expect(week()).toHaveTextContent("2 de 3 esta semana");
    await server.answer();
    // The week is said too: the pad's line is only in its description.
    expect(
      within(notices()).getByText("«Gimnasio» quedó hecho hoy. 1 de 2 hoy. 2 de 3 esta semana."),
    ).toBeInTheDocument();
  });

  test("a refused weekly tap rolls the week back", async () => {
    const user = userEvent.setup();
    renderPage();
    const week = () => pad("Gimnasio").querySelector("[data-habit-week]");
    await user.click(pad("Gimnasio"));
    expect(week()).toHaveTextContent("2 de 3 esta semana");
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(
      await within(notices()).findByText(`No se pudo registrar. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
    // The notice can render before useOptimistic rolls back.
    await waitFor(() => expect(week()).toHaveTextContent("1 de 3 esta semana"));
    await waitFor(() => expect(count()).toBe("0 de 2 hoy"));
  });

  test("a weekly habit whose week is met counts as done today, even untapped", () => {
    renderPage({ habits: [MEDITAR, { ...GYM, weekDoneBefore: 3 }] });
    expect(count()).toBe("1 de 2 hoy");
    expect(pad("Gimnasio")).toHaveAttribute("aria-pressed", "false");
    expect(pad("Gimnasio").querySelector("[data-habit-week]")).toHaveTextContent(
      "3 de 3 esta semana",
    );
  });
});

describe("the frequency in the form", () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Nuevo hábito" }));
    return screen.findByRole("dialog", { name: "Nuevo hábito" });
  }

  test("Por semana: X as radio keys (3 by default), the summary says it, the action gets it", async () => {
    const created = habit({ name: "Correr", frequency: "weekly_count", weeklyTarget: 4 });
    vi.mocked(createHabit).mockImplementation(() =>
      serverCall(
        (data) => ({ ...data, habits: [...data.habits, created] }),
        () => created,
      ),
    );
    const user = userEvent.setup();
    renderPage();
    const dialog = await openForm(user);
    const frequency = within(dialog).getByRole("radiogroup", { name: "Frecuencia" });
    expect(within(frequency).getByRole("radio", { name: "Diaria" })).toBeChecked();
    expect(within(dialog).getByText("Cada día · Sí o no")).toBeInTheDocument();
    await user.click(within(frequency).getByRole("radio", { name: "Por semana" }));
    const times = within(dialog).getByRole("radiogroup", { name: "Veces por semana" });
    expect(within(times).getByRole("radio", { name: "3" })).toBeChecked();
    expect(within(dialog).getByText("3 veces por semana · Sí o no")).toBeInTheDocument();
    // The arrows move the choice (a radio group).
    await user.click(within(times).getByRole("radio", { name: "3" }));
    await user.keyboard("{ArrowRight}");
    expect(within(times).getByRole("radio", { name: "4" })).toBeChecked();
    expect(within(times).getByRole("radio", { name: "4" })).toHaveFocus();
    expect(within(dialog).getByText("4 veces por semana · Sí o no")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Correr");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith({
      name: "Correr",
      lifeAreaId: null,
      frequency: "weekly_count",
      weeklyTarget: 4,
      weekdays: null,
      kind: "build",
      measure: "check",
    });
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(pad("Correr")).toHaveFocus());
  });

  test("Días fijos: none picked is an error on the days (focus on the first); then the days in words", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Inglés 2");
    await user.click(within(dialog).getByRole("radio", { name: "Días fijos" }));
    expect(within(dialog).getByText("Elige los días · Sí o no")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).not.toHaveBeenCalled();
    const days = within(dialog).getByRole("group", { name: "Días" });
    expect(days).toHaveAccessibleDescription(
      expect.stringContaining(FREQUENCY_ERRORS.weekdaysNone),
    );
    expect(within(days).getByRole("button", { name: "Lunes" })).toHaveFocus();

    await user.click(within(days).getByRole("button", { name: "Viernes" }));
    await user.click(within(days).getByRole("button", { name: "Lunes" }));
    expect(within(days).getByRole("button", { name: "Lunes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The error goes as soon as the days change.
    expect(within(dialog).queryByText(FREQUENCY_ERRORS.weekdaysNone)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Lunes y viernes · Sí o no")).toBeInTheDocument();
  });

  test("a habit created for another day: 'No tocan hoy' opens and its pad gets focus", async () => {
    const created = habit({ name: "Francés", frequency: "weekdays", weekdays: [2] });
    vi.mocked(createHabit).mockImplementation(() =>
      serverCall(
        (data) => ({ ...data, habits: [...data.habits, created] }),
        () => created,
      ),
    );
    const user = userEvent.setup();
    renderPage();
    const dialog = await openForm(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Francés");
    await user.click(within(dialog).getByRole("radio", { name: "Días fijos" }));
    await user.click(within(dialog).getByRole("button", { name: "Martes" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: "weekdays", weekdays: [2], weeklyTarget: null }),
    );
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /No tocan hoy/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() => expect(pad("Francés")).toHaveFocus());
    expect(padNames("not-due")).toEqual(["Inglés", "Francés"]);
  });
});

describe("edit", () => {
  test("Editar opens the form prefilled; saving updates the pad, focuses it and says so", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /No tocan hoy/ }));
    const options = await openOptions(user, "Inglés");
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    expect(screen.queryByRole("dialog", { name: "Inglés" })).not.toBeInTheDocument();
    const name = within(dialog).getByRole("textbox", { name: "Nombre" });
    expect(name).toHaveValue("Inglés");
    expect(within(dialog).getByRole("radio", { name: "Días fijos" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Lunes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Viernes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(dialog).getByText("Lunes y miércoles · Sí o no")).toBeInTheDocument();
    // Make it daily: it moves to today's grid.
    await user.clear(name);
    await user.type(name, "Inglés diario");
    await user.click(within(dialog).getByRole("radio", { name: "Diaria" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).toHaveBeenCalledWith({
      id: INGLES.id,
      name: "Inglés diario",
      lifeAreaId: null,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
    });
    expect(within(dialog).getByRole("button", { name: "Guardando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(pad("Inglés diario")).toHaveFocus());
    expect(padNames()).toEqual(["Meditar", "Inglés diario", "Gimnasio"]);
    await waitFor(() =>
      expect(announcer()).toHaveTextContent("Cambios guardados en «Inglés diario»."),
    );
  });

  test("closing the form without saving sends focus back to the options key", async () => {
    const user = userEvent.setup();
    renderPage();
    const options = await openOptions(user, "Meditar");
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Opciones de «Meditar»" })).toHaveFocus();
    expect(updateHabit).not.toHaveBeenCalled();
  });

  test("an area archived since stays offered and picked, marked as archived", async () => {
    const user = userEvent.setup();
    const kept = habit({ name: "Ordenar la casa", area: OLD_AREA });
    renderPage({ habits: [kept] });
    const options = await openOptions(user, "Ordenar la casa");
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    expect(within(dialog).getByRole("radio", { name: "Antigua (archivada)" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(updateHabit).toHaveBeenCalledWith(expect.objectContaining({ lifeAreaId: OLD_AREA.id }));
    await server.answer();
  });

  test("a refusal stays in the sheet with the reason", async () => {
    vi.mocked(updateHabit).mockResolvedValueOnce(fail(ORGANIZE_ERRORS.archivedEdit));
    const user = userEvent.setup();
    renderPage();
    const options = await openOptions(user, "Meditar");
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar hábito" });
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      ORGANIZE_ERRORS.archivedEdit,
    );
    expect(screen.getByRole("dialog", { name: "Editar hábito" })).toBeVisible();
  });
});

describe("archive and reactivate", () => {
  test("Archivar: out at once (focus to the neighbor), into 'Archivados'; Deshacer puts it back", async () => {
    const user = userEvent.setup();
    renderPage();
    const options = await openOptions(user, "Meditar");
    expect(within(options).getByRole("button", { name: "Archivar" })).toHaveAccessibleDescription(
      expect.stringContaining("conserva todo"),
    );
    await user.click(within(options).getByRole("button", { name: "Archivar" }));
    expect(archiveHabit).toHaveBeenCalledWith({ id: MEDITAR.id });
    expect(padNames()).toEqual(["Gimnasio"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(pad("Gimnasio")).toHaveFocus());
    await server.answer();
    expect(within(notices()).getByText("«Meditar» se archivó.")).toBeInTheDocument();
    // H5: "Archivados" (in "Semana") has it once saved.
    expect(screen.getByRole("button", { name: /Archivados/ })).toHaveTextContent("1");

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(unarchiveHabit).toHaveBeenCalledWith({ id: MEDITAR.id, position: "original" });
    expect(padNames()).toEqual(["Meditar", "Gimnasio"]);
    await server.answer();
    expect(padNames()).toEqual(["Meditar", "Gimnasio"]);
    expect(screen.queryByRole("button", { name: /Archivados/ })).not.toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent("«Meditar» volvió a su lugar."));
  });

  test("a refused archive brings the pad back with a notice", async () => {
    const user = userEvent.setup();
    renderPage();
    const options = await openOptions(user, "Meditar");
    await user.click(within(options).getByRole("button", { name: "Archivar" }));
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(
      await within(notices()).findByText(`No se pudo archivar. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
    // The notice can render before useOptimistic rolls back.
    await waitFor(() => expect(padNames()).toEqual(["Meditar", "Gimnasio"]));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Archivados/ })).not.toBeInTheDocument(),
    );
  });

  test("Reactivar (in 'Semana'): out of the list at once (focus to the next archived one), at the end of 'Hoy' once saved; Deshacer archives it again", async () => {
    const LEER = habit({ name: "Leer" });
    const OTRO = habit({ name: "Otro" });
    const user = userEvent.setup();
    renderPage({ habits: [MEDITAR], archived: [LEER, OTRO] });
    const section = screen.getByRole("button", { name: /Archivados/ });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(section).toHaveTextContent("2");
    await user.click(section);
    const list = screen.getByRole("list", { name: "Hábitos archivados" });
    await user.click(within(list).getByRole("button", { name: "Reactivar «Leer»" }));
    expect(unarchiveHabit).toHaveBeenCalledWith({ id: LEER.id, position: "end" });
    expect(
      within(list).queryByRole("button", { name: "Reactivar «Leer»" }),
    ).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Reactivar «Otro»" })).toHaveFocus();
    await server.answer();
    expect(padNames()).toEqual(["Meditar", "Leer"]);
    expect(within(notices()).getByText("«Leer» volvió a tus hábitos.")).toBeInTheDocument();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(archiveHabit).toHaveBeenCalledWith({ id: LEER.id });
    expect(within(list).getByRole("button", { name: "Reactivar «Leer»" })).toBeInTheDocument();
    await server.answer();
    expect(padNames()).toEqual(["Meditar"]);
    await waitFor(() => expect(announcer()).toHaveTextContent("«Leer» volvió a Archivados."));
  });

  test("reactivating the last archived one: the section leaves, focus goes to the heading", async () => {
    const LEER = habit({ name: "Leer" });
    const user = userEvent.setup();
    renderPage({ habits: [MEDITAR], archived: [LEER] });
    await user.click(screen.getByRole("button", { name: /Archivados/ }));
    await user.click(screen.getByRole("button", { name: "Reactivar «Leer»" }));
    expect(screen.getByRole("heading", { level: 1, name: "Hábitos" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Archivados/ })).not.toBeInTheDocument();
    await server.answer();
  });

  test("a refused reactivate takes it back to 'Archivados' with a notice", async () => {
    const LEER = habit({ name: "Leer" });
    const user = userEvent.setup();
    renderPage({ habits: [MEDITAR], archived: [LEER] });
    await user.click(screen.getByRole("button", { name: /Archivados/ }));
    await user.click(screen.getByRole("button", { name: "Reactivar «Leer»" }));
    await server.answer(fail(HABIT_ERRORS.notFound));
    expect(
      await within(notices()).findByText(`No se pudo reactivar. ${HABIT_ERRORS.notFound}`),
    ).toBeInTheDocument();
    await waitFor(() => expect(padNames()).toEqual(["Meditar"]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Archivados/ })).toHaveTextContent("1"),
    );
  });
});

describe("manual order", () => {
  async function startOrdering(user: ReturnType<typeof userEvent.setup>) {
    const key = screen.getByRole("button", { name: "Ordenar" });
    expect(key).toHaveAttribute("aria-pressed", "false");
    await user.click(key);
    expect(key).toHaveAttribute("aria-pressed", "true");
    return screen.findByRole("list", { name: "Orden de tus hábitos" });
  }
  const rowNames = (list: HTMLElement) =>
    within(list)
      .getAllByRole("listitem")
      .map((row) => row.querySelector(".line-clamp-2")?.textContent);

  test("'Ordenar' lists every active habit (also the ones not due today) instead of the pads", async () => {
    const user = userEvent.setup();
    renderPage();
    const list = await startOrdering(user);
    expect(rowNames(list)).toEqual(["Meditar", "Inglés", "Gimnasio"]);
    expect(grid("due")).toBeNull();
    // Waits for dnd-kit to replace the plain list (the handle gets its role description).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mover «Meditar»" })).toHaveAttribute(
        "aria-roledescription",
        "elemento ordenable",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Ordenar" }));
    expect(padNames()).toEqual(["Meditar", "Gimnasio"]);
  });

  test("Bajar moves at once, keeps focus, and sends every id; Deshacer restores the order", async () => {
    const user = userEvent.setup();
    renderPage();
    const list = await startOrdering(user);
    const up = within(list).getByRole("button", { name: "Subir «Meditar»" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    await user.click(up);
    expect(reorderHabits).not.toHaveBeenCalled();

    await user.click(within(list).getByRole("button", { name: "Bajar «Meditar»" }));
    expect(rowNames(screen.getByRole("list", { name: "Orden de tus hábitos" }))).toEqual([
      "Inglés",
      "Meditar",
      "Gimnasio",
    ]);
    expect(reorderHabits).toHaveBeenCalledWith({ ids: [INGLES.id, MEDITAR.id, GYM.id] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bajar «Meditar»" })).toHaveFocus(),
    );
    expect(within(notices()).getByText("«Meditar» pasó al lugar 2 de 3.")).toBeInTheDocument();
    // A second move shares the notice; its Deshacer goes back to before the first.
    await user.click(screen.getByRole("button", { name: "Bajar «Meditar»" }));
    expect(within(notices()).getByText("«Meditar» pasó al lugar 3 de 3.")).toBeInTheDocument();
    await server.answer();
    await server.answer();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(reorderHabits).toHaveBeenLastCalledWith({ ids: [MEDITAR.id, INGLES.id, GYM.id] });
    await server.answer();
    expect(rowNames(screen.getByRole("list", { name: "Orden de tus hábitos" }))).toEqual([
      "Meditar",
      "Inglés",
      "Gimnasio",
    ]);
    expect(within(notices()).getByText("El orden volvió a como estaba.")).toBeInTheDocument();
  });

  test("a stale list is refused: the order rolls back with the reason", async () => {
    const user = userEvent.setup();
    renderPage();
    const list = await startOrdering(user);
    await user.click(within(list).getByRole("button", { name: "Bajar «Gimnasio»" }));
    expect(reorderHabits).not.toHaveBeenCalled();
    await user.click(within(list).getByRole("button", { name: "Subir «Gimnasio»" }));
    // Positive control for the end: the move's notice is there before the refusal.
    expect(within(notices()).getByText(/«Gimnasio» pasó al lugar 2 de 3\./)).toBeInTheDocument();
    await server.answer(fail(ORGANIZE_ERRORS.staleOrder));
    expect(
      await within(notices()).findByText(
        `No se pudo guardar el orden. ${ORGANIZE_ERRORS.staleOrder}`,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(rowNames(screen.getByRole("list", { name: "Orden de tus hábitos" }))).toEqual([
        "Meditar",
        "Inglés",
        "Gimnasio",
      ]),
    );
    // The burst's notice with Deshacer went with it.
    expect(within(notices()).queryByText(/pasó al lugar/)).not.toBeInTheDocument();
  });

  test("down to one habit while ordering: the mode ends, focus to the heading, never back by itself", async () => {
    const user = userEvent.setup();
    renderPage({ habits: [MEDITAR, GYM] });
    await startOrdering(user);
    expect(screen.getByRole("button", { name: "Ordenar" })).toHaveFocus();
    // Deleted in another tab: the revalidation brings one habit.
    act(() => server.render({ habits: [MEDITAR], archived: [] }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Hábitos" })).toHaveFocus(),
    );
    expect(screen.queryByRole("list", { name: "Orden de tus hábitos" })).not.toBeInTheDocument();
    expect(padNames()).toEqual(["Meditar"]);
    act(() => server.render({ habits: [MEDITAR, GYM], archived: [] }));
    expect(screen.getByRole("button", { name: "Ordenar" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(padNames()).toEqual(["Meditar", "Gimnasio"]);
  });

  test("with a single habit there is nothing to order", () => {
    renderPage({ habits: [MEDITAR] });
    expect(screen.queryByRole("button", { name: "Ordenar" })).not.toBeInTheDocument();
  });
});
