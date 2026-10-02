// H4 of `habits` on /habits "Hoy": the streak on the pad (and after a tap, at once), the
// milestones in the notice, "En pausa (N)" with "Reanudar" and its "Deshacer", the pause sheet
// (defaults, validation, the server's refusal, "Deshacer") and "Registrar otro día", against a
// fake server.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import type { HabitItem } from "@/modules/habits/habit-input";
import { logHabit, setHabitDone, setHabitQuantity } from "@/modules/habits/log-actions";
import { pauseHabit, removeHabitPause, resumeHabit } from "@/modules/habits/pause-actions";
import { PAUSE_ERRORS } from "@/modules/habits/pause-copy";

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

const TODAY = "2026-10-02";
/** 10:00 in Lima on TODAY (a Friday). Only Date is faked (timers stay real for userEvent). */
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
    ...values,
  };
}

const LEER = habit({ name: "Leer", streak: { unit: "days", done: 9, notDone: 8 } });
const MEDITAR = habit({ name: "Meditar", streak: { unit: "days", done: 7, notDone: 6 } });
const GYM = habit({
  name: "Gimnasio",
  frequency: "weekly_count",
  weeklyTarget: 3,
  weekDoneBefore: 1,
  streak: { unit: "weeks", done: 3, notDone: 3 },
});
const AGUA = habit({
  name: "Agua",
  measure: "quantity",
  goal: 8,
  target: 8,
  unit: "vasos",
  quantity: 7,
  streak: { unit: "days", done: 30, notDone: 29 },
  recentLogs: [{ day: "2026-09-30", quantity: 6, target: 8 }],
});
const NUEVO = habit({ name: "Nuevo", startDate: TODAY });
const CORRER = habit({
  name: "Correr",
  pause: {
    id: "00000000-0000-4000-8000-0000000000aa",
    startDate: "2026-09-30",
    endDate: "2026-10-09",
    reason: "Viaje",
  },
});
const HABITS = [LEER, MEDITAR, GYM, AGUA, NUEVO, CORRER];

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

const NEW_PAUSE = {
  id: "00000000-0000-4000-8000-0000000000bb",
  startDate: TODAY,
  endDate: "2026-10-08",
  reason: null,
};

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
  const same = (item: HabitItem) => item;
  vi.mocked(setHabitDone)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, day, done } = input as { id: string; day: string; done: boolean };
      if (day !== TODAY)
        return serverChange(id, same, (item) => ({ ...item, quantity: done ? 1 : 0 }));
      return serverChange(id, (item) => ({ ...item, quantity: done ? 1 : 0, hasLogs: true }), same);
    });
  vi.mocked(logHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, delta } = input as { id: string; delta: number };
      return serverChange(id, (item) => ({ ...item, quantity: item.quantity + delta }), same);
    });
  vi.mocked(setHabitQuantity)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, quantity } = input as { id: string; quantity: number };
      return serverChange(id, same, (item) => ({ ...item, quantity, target: 8 }));
    });
  vi.mocked(pauseHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id, startDate, endDate, reason } = input as typeof NEW_PAUSE & { id: string };
      const pause = { ...NEW_PAUSE, startDate, endDate, reason };
      return serverChange(
        id,
        (item) => ({ ...item, pause }),
        (item) => ({ habit: item, pause }),
      );
    });
  vi.mocked(resumeHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      const before = server.habits.find((item) => item.id === id)!.pause!;
      return serverChange(
        id,
        (item) => ({ ...item, pause: null }),
        (item) => ({ habit: item, outcome: "ended" as const, pause: before }),
      );
    });
  vi.mocked(removeHabitPause)
    .mockReset()
    .mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return serverChange(id, (item) => ({ ...item, pause: null }), same);
    });
});

afterEach(async () => {
  await server.answerAll();
  vi.useRealTimers();
});

const pad = (name: string) => screen.getByRole("button", { name });
const streakLine = (name: string) => pad(name).querySelector("[data-habit-streak]")?.textContent;
const count = () => document.querySelector("[data-habits-count]")?.textContent;
const notices = () => screen.getByRole("region", { name: "Avisos" });

async function openOptions(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
  return screen.findByRole("dialog", { name });
}

describe("the streak on the pad", () => {
  test("RACHA 8 (days), RACHA 3 SEM (weeks), none at 0; described for screen readers", () => {
    render(<Harness />);
    expect(streakLine("Leer")).toBe("RACHA 8");
    expect(pad("Leer")).toHaveAccessibleDescription("Racha: 8 días.");
    expect(streakLine("Gimnasio")).toBe("RACHA 3 SEM");
    expect(pad("Gimnasio")).toHaveAccessibleDescription(/Racha: 3 semanas\./);
    expect(streakLine("Nuevo")).toBeUndefined();
    // Never red: the line is the pad's plain sub-label.
    expect(pad("Leer").querySelector("[data-habit-streak]")).toHaveClass("bo-key__sub");
  });

  test("a tap moves it at once (optimistic); Deshacer brings it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Leer"));
    expect(streakLine("Leer")).toBe("RACHA 9");
    await server.answer();
    expect(within(notices()).getByText("Hecho")).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(streakLine("Leer")).toBe("RACHA 8");
  });

  test("a failed tap rolls the streak back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Leer"));
    expect(streakLine("Leer")).toBe("RACHA 9");
    await server.answer(fail("No."));
    await waitFor(() => expect(streakLine("Leer")).toBe("RACHA 8"));
  });
});

describe("milestones", () => {
  test("reaching 7 days: a notice of its own (no confetti dependency)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    await server.answer();
    expect(within(notices()).getByText("¡7 días seguidos!")).toBeVisible();
    expect(within(notices()).getByText(/«Meditar»: así empieza un hábito\./)).toBeVisible();
    // Still undoable.
    expect(within(notices()).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(document.querySelector("canvas")).toBeNull();
  });

  test("a quantity reaching its goal reaches 30 days", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Agua"));
    await server.answer();
    expect(within(notices()).getByText("¡30 días seguidos!")).toBeVisible();
  });

  test("a tap that doesn't reach one says the usual notice (positive control)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Leer"));
    await server.answer();
    expect(within(notices()).getByText("Hecho")).toBeVisible();
    expect(within(notices()).queryByText(/seguidos!/)).not.toBeInTheDocument();
  });
});

describe("En pausa", () => {
  test("a habit paused today is out of the grid and the count, folded in 'En pausa (1)'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const grid = screen.getByRole("list", { name: "Hábitos de hoy" });
    expect(within(grid).queryByRole("button", { name: "Correr" })).not.toBeInTheDocument();
    expect(count()).toBe("0 de 5 hoy");
    const toggle = screen.getByRole("button", { name: /^En pausa\s*1$/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    const list = screen.getByRole("list", { name: "Hábitos en pausa" });
    expect(within(list).getByText("Correr")).toBeVisible();
    expect(within(list).getByText("En pausa hasta el 9 de octubre · Viaje")).toBeVisible();
  });

  test("Reanudar: back to the grid at once, focus to its pad; Deshacer pauses it again", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    await user.click(screen.getByRole("button", { name: "Reanudar «Correr»" }));
    expect(resumeHabit).toHaveBeenCalledWith({ id: CORRER.id, pauseId: CORRER.pause!.id });
    expect(screen.queryByRole("button", { name: /^En pausa\s*1$/ })).not.toBeInTheDocument();
    await waitFor(() => expect(pad("Correr")).toHaveFocus());
    expect(count()).toBe("0 de 6 hoy");
    await server.answer();
    expect(within(notices()).getByText("«Correr» volvió a tus hábitos de hoy.")).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    // Ended yesterday: "Deshacer" pauses from today to the old end, with its reason.
    expect(pauseHabit).toHaveBeenCalledWith({
      id: CORRER.id,
      startDate: TODAY,
      endDate: "2026-10-09",
      reason: "Viaje",
    });
    expect(screen.getByRole("button", { name: /^En pausa\s*1$/ })).toBeInTheDocument();
  });

  test("a failed Reanudar rolls back into 'En pausa'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    await user.click(screen.getByRole("button", { name: "Reanudar «Correr»" }));
    await server.answer(fail("Esa pausa ya no existe."));
    expect(within(notices()).getByText("Sin guardar")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^En pausa\s*1$/ })).toBeInTheDocument(),
    );
  });

  test("the options of a paused habit say until when, with Reanudar (no Pausar)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    const options = await openOptions(user, "Correr");
    expect(within(options).getByText("En pausa hasta el 9 de octubre · Viaje")).toBeVisible();
    expect(within(options).queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
    await user.click(within(options).getByRole("button", { name: "Reanudar" }));
    await waitFor(() => expect(resumeHabit).toHaveBeenCalled());
    await waitFor(() => expect(pad("Correr")).toHaveFocus());
  });
});

describe("the pause sheet", () => {
  async function openPause(user: ReturnType<typeof userEvent.setup>) {
    const options = await openOptions(user, "Leer");
    await user.click(within(options).getByRole("button", { name: "Pausar" }));
    return screen.findByRole("dialog", { name: "Pausar «Leer»" });
  }

  test("starts today for a week; pausing moves the habit to 'En pausa' with Deshacer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openPause(user);
    const start = within(sheet).getByLabelText("Desde");
    expect(start).toHaveValue(TODAY);
    expect(start).toHaveFocus();
    expect(within(sheet).getByLabelText("Hasta (incluido)")).toHaveValue("2026-10-08");
    expect(within(sheet).getByText("Pausa de 7 días.")).toBeVisible();
    await user.type(within(sheet).getByRole("textbox", { name: "Motivo (opcional)" }), "Gripe");
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    expect(pauseHabit).toHaveBeenCalledWith({
      id: LEER.id,
      startDate: TODAY,
      endDate: "2026-10-08",
      reason: "Gripe",
    });
    // Not optimistic: waiting, the sheet stays (its key says so, aria-disabled).
    expect(within(sheet).getByRole("button", { name: "Pausando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      within(notices()).getByText(/«Leer» quedó en pausa hasta el 8 de octubre\./),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reanudar «Leer»" })).toHaveFocus(),
    );
    expect(count()).toBe("0 de 4 hoy");
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(removeHabitPause).toHaveBeenCalledWith({ id: LEER.id, pauseId: NEW_PAUSE.id });
  });

  test("invalid dates are said on their field, with focus, and nothing is sent", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openPause(user);
    const end = within(sheet).getByLabelText("Hasta (incluido)");
    await user.clear(end);
    await user.type(end, "2026-09-30");
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    expect(end).toHaveAccessibleDescription(PAUSE_ERRORS.endBeforeStart);
    expect(end).toHaveFocus();
    const start = within(sheet).getByLabelText("Desde");
    await user.clear(start);
    await user.type(start, "2026-09-24");
    await user.clear(end);
    await user.type(end, "2026-09-26");
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    expect(start).toHaveAccessibleDescription(PAUSE_ERRORS.startTooEarly);
    expect(start).toHaveFocus();
    expect(pauseHabit).not.toHaveBeenCalled();
    // Positive control: 7 days back is fine.
    await user.clear(start);
    await user.type(start, "2026-09-25");
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    expect(pauseHabit).toHaveBeenCalledTimes(1);
  });

  test("an overlap refused by the server shows on 'Desde' and the sheet stays open", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openPause(user);
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    await server.answer({
      ok: false,
      error: "Revisa los campos.",
      fieldErrors: { startDate: [PAUSE_ERRORS.overlap] },
    });
    const start = within(sheet).getByLabelText("Desde");
    await waitFor(() => expect(start).toHaveAccessibleDescription(PAUSE_ERRORS.overlap));
    expect(start).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Pausar «Leer»" })).toBeVisible();
  });
});

describe("Registrar otro día", () => {
  async function openOther(user: ReturnType<typeof userEvent.setup>, name: string) {
    const options = await openOptions(user, name);
    await user.click(within(options).getByRole("button", { name: "Registrar otro día" }));
    return screen.findByRole("dialog", { name: `Registrar «${name}»` });
  }

  test("a yes/no: yesterday first, marked with the switch; Deshacer unmarks it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openOther(user, "Leer");
    const days = within(sheet).getAllByRole("radio");
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName("Ayer, jueves 1 de octubre");
    expect(days[0]).toHaveTextContent("Ayer");
    expect(days[0]).toHaveAttribute("aria-checked", "true");
    expect(days[6]).toHaveAccessibleName("viernes 25 de setiembre");
    const done = within(sheet).getByRole("switch", { name: "Hecho ese día" });
    expect(done).toHaveAttribute("aria-checked", "false");
    await user.click(done);
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitDone).toHaveBeenCalledWith({ id: LEER.id, day: "2026-10-01", done: true });
    // Today's pad is untouched.
    expect(pad("Leer")).toHaveAttribute("aria-pressed", "false");
    await server.answer();
    expect(within(notices()).getByText("«Leer», jueves, 1 de octubre: hecho.")).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: LEER.id, day: "2026-10-01", done: false });
  });

  test("a quantity: the day picked shows what it has; the exact value is saved", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openOther(user, "Agua");
    const field = within(sheet).getByRole("textbox", { name: "Cantidad (vasos)" });
    expect(field).toHaveValue("0");
    await user.click(within(sheet).getByRole("radio", { name: "miércoles 30 de setiembre" }));
    expect(field).toHaveValue("6");
    expect(field).toHaveAccessibleDescription("Meta del día: 8 vasos.");
    await user.clear(field);
    await user.type(field, "8");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitQuantity).toHaveBeenCalledWith({ id: AGUA.id, day: "2026-09-30", quantity: 8 });
    await server.answer();
    expect(
      within(notices()).getByText("«Agua», miércoles, 30 de setiembre: 8 de 8 vasos."),
    ).toBeVisible();
  });

  test("the same value saves nothing; a habit started today has no earlier day", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openOther(user, "Leer");
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitDone).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const options = await openOptions(user, "Nuevo");
    expect(
      within(options).queryByRole("button", { name: "Registrar otro día" }),
    ).not.toBeInTheDocument();
    // Positive control: it can still be paused.
    expect(within(options).getByRole("button", { name: "Pausar" })).toBeVisible();
  });
});

describe("more pause flows", () => {
  const AHEAD = habit({
    name: "Nadar",
    pause: {
      id: "00000000-0000-4000-8000-0000000000cc",
      startDate: "2026-10-10",
      endDate: "2026-10-20",
      reason: null,
    },
  });

  test("a pause that starts later: the habit stays in the grid; its notice says when", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "Leer");
    await user.click(within(options).getByRole("button", { name: "Pausar" }));
    const sheet = await screen.findByRole("dialog", { name: "Pausar «Leer»" });
    const start = within(sheet).getByLabelText("Desde");
    const end = within(sheet).getByLabelText("Hasta (incluido)");
    await user.clear(end);
    await user.type(end, "2026-10-15");
    await user.clear(start);
    await user.type(start, "2026-10-10");
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    await server.answer();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      within(notices()).getByText("«Leer» se pausará del 10 de octubre al 15 de octubre."),
    ).toBeVisible();
    expect(pad("Leer")).toBeInTheDocument();
    expect(count()).toBe("0 de 5 hoy");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Opciones de «Leer»" })).toHaveFocus(),
    );
  });

  test("Cancelar la pausa (not started): its Deshacer sends the same dates", async () => {
    server.habits = [AHEAD];
    vi.mocked(resumeHabit).mockImplementationOnce(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => ({ ...item, pause: null }),
        (item) => ({ habit: item, outcome: "removed" as const, pause: AHEAD.pause! }),
      );
    });
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "Nadar");
    expect(within(options).getByText("Pausa del 10 de octubre al 20 de octubre")).toBeVisible();
    await user.click(within(options).getByRole("button", { name: "Cancelar la pausa" }));
    await waitFor(() => expect(resumeHabit).toHaveBeenCalled());
    await server.answer();
    expect(within(notices()).getByText("La pausa de «Nadar» se canceló.")).toBeVisible();
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(pauseHabit).toHaveBeenCalledWith({
      id: AHEAD.id,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
      reason: null,
    });
  });

  test("a pause that had already ended: the notice has no Deshacer", async () => {
    vi.mocked(resumeHabit).mockImplementationOnce(async (input) => {
      const { id } = input as { id: string };
      return serverChange(
        id,
        (item) => ({ ...item, pause: null }),
        (item) => ({ habit: item, outcome: "none" as const, pause: CORRER.pause! }),
      );
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    await user.click(screen.getByRole("button", { name: "Reanudar «Correr»" }));
    await server.answer();
    expect(within(notices()).getByText("«Correr» volvió a tus hábitos de hoy.")).toBeVisible();
    expect(within(notices()).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  test("Reanudar twice quickly sends it once", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^En pausa\s*1$/ }));
    const resume = screen.getByRole("button", { name: "Reanudar «Correr»" });
    await user.dblClick(resume);
    expect(resumeHabit).toHaveBeenCalledTimes(1);
  });

  test("Deshacer of Pausar: focus follows the habit back to its pad", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "Leer");
    await user.click(within(options).getByRole("button", { name: "Pausar" }));
    const sheet = await screen.findByRole("dialog", { name: "Pausar «Leer»" });
    await user.click(within(sheet).getByRole("button", { name: "Pausar" }));
    await server.answer();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reanudar «Leer»" })).toHaveFocus(),
    );
    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(pad("Leer")).toHaveFocus());
    await server.answer();
    expect(count()).toBe("0 de 5 hoy");
  });
});

describe("more milestones and other days", () => {
  test("weeks: '¡7 semanas seguidas!'", async () => {
    server.habits = [
      habit({
        name: "Gimnasio",
        frequency: "weekly_count",
        weeklyTarget: 3,
        weekDoneBefore: 2,
        streak: { unit: "weeks", done: 7, notDone: 6 },
      }),
    ];
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Gimnasio"));
    await server.answer();
    expect(within(notices()).getByText("¡7 semanas seguidas!")).toBeVisible();
  });

  test("a failed tap that would reach 7: no celebration, the streak back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(pad("Meditar"));
    expect(streakLine("Meditar")).toBe("RACHA 7");
    await server.answer(fail("No."));
    expect(within(notices()).getByText("Sin guardar")).toBeVisible();
    expect(within(notices()).queryByText(/seguidos!/)).not.toBeInTheDocument();
    await waitFor(() => expect(streakLine("Meditar")).toBe("RACHA 6"));
  });

  test("a habit to avoid: 'Recaída ese día'; a paused day is marked in words", async () => {
    server.habits = [
      habit({
        name: "No fumar",
        kind: "avoid",
        streak: { unit: "days", done: 9, notDone: 0 },
        recentPaused: ["2026-09-30"],
      }),
    ];
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "No fumar");
    await user.click(within(options).getByRole("button", { name: "Registrar otro día" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar «No fumar»" });
    const paused = within(sheet).getByRole("radio", {
      name: "miércoles 30 de setiembre, en pausa",
    });
    await user.click(paused);
    expect(within(sheet).getByText(/Ese día estaba en pausa/)).toBeVisible();
    await user.click(within(sheet).getByRole("switch", { name: "Recaída ese día" }));
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitDone).toHaveBeenCalledWith({
      id: server.habits[0].id,
      day: "2026-09-30",
      done: true,
    });
    await server.answer();
    expect(
      within(notices()).getByText("«No fumar», miércoles, 30 de setiembre: recaída registrada."),
    ).toBeVisible();
  });

  test("a failed save of another day says so", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const options = await openOptions(user, "Leer");
    await user.click(within(options).getByRole("button", { name: "Registrar otro día" }));
    const sheet = await screen.findByRole("dialog", { name: "Registrar «Leer»" });
    expect(within(sheet).getAllByRole("radio")[0]).toHaveAccessibleName(
      "Ayer, jueves 1 de octubre",
    );
    await user.click(within(sheet).getByRole("switch", { name: "Hecho ese día" }));
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await server.answer(fail("Solo puedes registrar hoy y los 7 días anteriores."));
    expect(within(notices()).getByText("Sin guardar")).toBeVisible();
    expect(within(notices()).getByText(/No se pudo registrar ese día\./)).toBeVisible();
  });
});
