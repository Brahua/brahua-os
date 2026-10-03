// H5 of `habits` (components, against a fake server): the calendar as a grid (roving tabindex,
// arrows, read-only days), a habit's page (stats, logging a day of the calendar with "Deshacer",
// pauses, archive, delete with confirmation), the "Semana" view and "Más detalles" in the form.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ok, type ActionResult } from "@/lib/action-result";
import { createHabit, deleteHabit } from "@/modules/habits/actions";
import { HabitCalendar, type CalendarDay } from "@/modules/habits/components/habit-calendar";
import { HabitDetail } from "@/modules/habits/components/habit-detail";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { HabitsWeekView } from "@/modules/habits/components/habits-week";
import type { HabitDayLog, HabitItem, HabitPauseSummary } from "@/modules/habits/habit-input";
import { DETAILS_ERRORS } from "@/modules/habits/history-copy";
import type { HabitsWeek } from "@/modules/habits/history";
import { setHabitDone } from "@/modules/habits/log-actions";
import { archiveHabit, unarchiveHabit } from "@/modules/habits/organize-actions";
import { resumeHabit } from "@/modules/habits/pause-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
// NumberFlow is a custom element jsdom can't update: the figure as plain text.
vi.mock("@number-flow/react", () => ({ default: ({ value }: { value: number }) => <>{value}</> }));
vi.mock("@/modules/habits/actions", () => ({
  createHabit: vi.fn(),
  deleteHabit: vi.fn(),
  restoreHabit: vi.fn(),
}));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  setHabitQuantity: vi.fn(),
  logHabit: vi.fn(),
}));
vi.mock("@/modules/habits/organize-actions", () => ({
  archiveHabit: vi.fn(),
  unarchiveHabit: vi.fn(),
  updateHabit: vi.fn(),
  reorderHabits: vi.fn(),
}));
vi.mock("@/modules/habits/pause-actions", () => ({
  pauseHabit: vi.fn(),
  resumeHabit: vi.fn(),
  removeHabitPause: vi.fn(),
}));

// Friday 2026-10-02, 10:00 in Lima.
const TODAY = "2026-10-02";
const NOW = new Date("2026-10-02T15:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";

function habit(values: Partial<HabitItem> = {}): HabitItem {
  return {
    id: ID,
    name: "Leer",
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
    hasLogs: true,
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

const done = (day: string): HabitDayLog => ({ day, quantity: 1, target: 1 });

type Data = { logs: HabitDayLog[]; pauses: HabitPauseSummary[]; archived: boolean };

/** A fake server: each call waits until the test answers it, then re-renders the page with it. */
const server = {
  data: { logs: [], pauses: [], archived: false } as Data,
  render: (() => {}) as (data: Data) => void,
  pending: [] as { answer: (result?: ActionResult<unknown>) => void }[],
  async answer(result?: ActionResult<unknown>) {
    const call = server.pending.shift();
    if (!call) throw new Error("No pending call");
    await act(async () => call.answer(result));
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

function Detail({ item }: { item: HabitItem }) {
  const [data, setData] = useState(server.data);
  useLayoutEffect(() => {
    server.render = setData;
  }, []);
  return (
    <HabitsScreen today={TODAY} areas={[]}>
      <HabitDetail
        habit={item}
        archived={data.archived}
        logs={data.logs}
        pauses={data.pauses}
        month="2026-10"
        headingId="habit-title"
      />
    </HabitsScreen>
  );
}

function renderDetail(item: HabitItem, data: Partial<Data> = {}) {
  server.data = { logs: [], pauses: [], archived: false, ...data };
  return render(<Detail item={item} />);
}

const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-habits-announcer]");
const dayKey = (day: string) => document.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)!;
/** A stat's figure as screen readers get it. */
const stat = (name: string) =>
  document.querySelector(`[data-habit-stat="${name}"] .bo-stat__value .sr-only`)?.textContent;

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
  router.replace.mockReset();
  vi.mocked(setHabitDone)
    .mockReset()
    .mockImplementation(async (input) => {
      const { day, done: marked } = input as { day: string; done: boolean };
      return serverCall(
        (data) => ({
          ...data,
          logs: [
            ...data.logs.filter((log) => log.day !== day),
            { day, quantity: marked ? 1 : 0, target: 1 },
          ],
        }),
        () => habit({ quantity: marked ? 1 : 0 }),
      );
    });
  vi.mocked(archiveHabit)
    .mockReset()
    .mockImplementation(async () =>
      serverCall(
        (data) => ({ ...data, archived: true }),
        () => habit(),
      ),
    );
  vi.mocked(unarchiveHabit)
    .mockReset()
    .mockImplementation(async () =>
      serverCall(
        (data) => ({ ...data, archived: false }),
        () => habit(),
      ),
    );
  vi.mocked(resumeHabit)
    .mockReset()
    .mockImplementation(async (input) => {
      const { pauseId } = input as { pauseId: string };
      const pause = server.data.pauses.find((item) => item.id === pauseId)!;
      return serverCall(
        (data) => ({
          ...data,
          pauses: data.pauses.map((item) =>
            item.id === pauseId ? { ...item, endDate: "2026-10-01" } : item,
          ),
        }),
        () => ({ habit: habit(), outcome: "ended" as const, pause }),
      );
    });
  vi.mocked(deleteHabit)
    .mockReset()
    .mockImplementation(async () =>
      serverCall(
        (data) => data,
        () => ({ id: ID, name: "Leer" }),
      ),
    );
  vi.mocked(createHabit).mockReset();
});

describe("the calendar grid", () => {
  const dayOf = (day: string): CalendarDay => ({
    status: day > TODAY ? "future" : "empty",
    fill: 0,
    label: `día ${day}`,
    loggable: day <= TODAY && day >= "2026-09-25",
  });

  function renderCalendar(onOpenDay = vi.fn()) {
    render(
      <>
        <h2 id="month">Octubre de 2026</h2>
        <p id="help">Ayuda</p>
        <HabitCalendar
          month="2026-10"
          today={TODAY}
          dayOf={dayOf}
          onOpenDay={onOpenDay}
          labelledBy="month"
          describedBy="help"
        />
      </>,
    );
    return onOpenDay;
  }

  test("a grid of weeks with its weekday headers; today is the one tab stop", () => {
    renderCalendar();
    const grid = screen.getByRole("grid", { name: "Octubre de 2026" });
    expect(grid).toHaveAccessibleDescription("Ayuda");
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Llunes", "Mmartes", "Mmiércoles", "Jjueves", "Vviernes", "Ssábado", "Ddomingo"]);
    // October 2026 starts on a Thursday: 5 weeks plus the header row.
    expect(within(grid).getAllByRole("row")).toHaveLength(6);
    const tabStops = within(grid)
      .getAllByRole("button")
      .filter((key) => key.tabIndex === 0);
    expect(tabStops).toEqual([dayKey(TODAY)]);
    expect(dayKey(TODAY)).toHaveAttribute("aria-current", "date");
    expect(dayKey(TODAY)).toHaveAccessibleName(`día ${TODAY}`);
  });

  test("arrows, Home and End move focus (and the tab stop) within the month", async () => {
    const user = userEvent.setup();
    renderCalendar();
    dayKey(TODAY).focus();
    await user.keyboard("{ArrowLeft}");
    expect(dayKey("2026-10-01")).toHaveFocus();
    expect(dayKey("2026-10-01").tabIndex).toBe(0);
    expect(dayKey(TODAY).tabIndex).toBe(-1);
    // The 1st is the month's first day: nothing before it.
    await user.keyboard("{ArrowLeft}");
    expect(dayKey("2026-10-01")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(dayKey("2026-10-08")).toHaveFocus();
    await user.keyboard("{End}");
    expect(dayKey("2026-10-11")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(dayKey("2026-10-05")).toHaveFocus();
    await user.keyboard("{Control>}{End}{/Control}");
    expect(dayKey("2026-10-31")).toHaveFocus();
  });

  test("only the days that can be logged open; the others are aria-disabled, still focusable", async () => {
    const user = userEvent.setup();
    const onOpenDay = renderCalendar();
    expect(dayKey("2026-10-20")).toHaveAttribute("aria-disabled", "true");
    await user.click(dayKey("2026-10-20"));
    expect(onOpenDay).not.toHaveBeenCalled();
    expect(dayKey("2026-10-01")).not.toHaveAttribute("aria-disabled");
    expect(dayKey("2026-10-01")).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(dayKey("2026-10-01"));
    expect(onOpenDay).toHaveBeenCalledWith("2026-10-01", dayKey("2026-10-01"));
  });
});

describe("a habit's page", () => {
  test("its header, its stats and each day's full name", () => {
    renderDetail(habit({ identity: "Soy alguien que lee", cue: "Después del desayuno" }), {
      logs: [done("2026-09-28"), done("2026-09-29"), done("2026-09-30"), done("2026-10-02")],
    });
    expect(screen.getByRole("heading", { level: 1, name: "Leer" })).toBeInTheDocument();
    expect(document.querySelector("[data-habit-identity]")).toHaveTextContent(
      "Soy alguien que lee",
    );
    expect(document.querySelector("[data-habit-cue]")).toHaveTextContent("Después del desayuno");
    expect(document.querySelector("[data-habit-rule]")).toHaveTextContent("Cada día · Sí o no");
    // Yesterday (1st) isn't done: the streak is today's 1; the best is 3.
    expect(stat("current")).toBe("1");
    expect(stat("best")).toBe("3");
    // October: the 1st open, today done.
    expect(stat("month")).toBe("1");
    expect(document.querySelector('[data-habit-stat="month"]')).toHaveTextContent("de 2");
    expect(stat("total")).toBe("4");
    expect(dayKey("2026-10-01")).toHaveAccessibleName("jueves 1 de octubre: sin marcar");
    expect(dayKey(TODAY)).toHaveAccessibleName("viernes 2 de octubre (hoy): hecho");
    expect(dayKey("2026-10-03")).toHaveAccessibleName("sábado 3 de octubre: por venir");
    expect(dayKey("2026-10-03")).toHaveAttribute("aria-disabled", "true");
  });

  test("a day of the calendar: the sheet opens on it; saving is optimistic with Deshacer", async () => {
    const user = userEvent.setup();
    renderDetail(habit(), { logs: [done("2026-09-29"), done("2026-09-30")] });
    // Yesterday (the 1st) is open: no streak yet.
    expect(stat("current")).toBe("0");
    await user.click(dayKey("2026-10-01"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar «Leer»" });
    // Today and the 7 days before, the one picked checked.
    expect(within(sheet).getAllByRole("radio")).toHaveLength(8);
    expect(within(sheet).getByRole("radio", { name: /^Hoy/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(sheet).getByRole("radio", { name: /^Ayer/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(within(sheet).getByRole("switch", { name: "Hecho ese día" }));
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(setHabitDone).toHaveBeenCalledWith({ id: ID, day: "2026-10-01", done: true });
    // At once: the day and the streak.
    expect(dayKey("2026-10-01")).toHaveAccessibleName("jueves 1 de octubre: hecho");
    expect(stat("current")).toBe("3");
    await server.answer();
    expect(
      within(notices()).getByText(/«Leer», jueves, 1 de octubre: hecho\./),
    ).toBeInTheDocument();
    await waitFor(() => expect(dayKey("2026-10-01")).toHaveFocus());

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(setHabitDone).toHaveBeenLastCalledWith({ id: ID, day: "2026-10-01", done: false });
    expect(dayKey("2026-10-01")).toHaveAccessibleName("jueves 1 de octubre: sin marcar");
    await server.answer();
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "«Leer» volvió a quedar así el jueves, 1 de octubre: sin marcar.",
      ),
    );
  });

  test("a refused log rolls the day back with a notice", async () => {
    const user = userEvent.setup();
    renderDetail(habit());
    await user.click(dayKey("2026-10-01"));
    const sheet = await screen.findByRole("dialog", { name: "Registrar «Leer»" });
    await user.click(within(sheet).getByRole("switch", { name: "Hecho ese día" }));
    await user.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await server.answer({ ok: false, error: "Ese día no es válido." });
    expect(
      await within(notices()).findByText("No se pudo registrar ese día. Ese día no es válido."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(dayKey("2026-10-01")).toHaveAccessibleName("jueves 1 de octubre: sin marcar"),
    );
  });

  test("pauses: the current one resumes (optimistic, to the past ones); a paused day is rest", async () => {
    const user = userEvent.setup();
    const pause = { id: "p1", startDate: "2026-09-30", endDate: "2026-10-05", reason: "Viaje" };
    const past = { id: "p0", startDate: "2026-09-10", endDate: "2026-09-12", reason: null };
    renderDetail(habit(), { pauses: [past, pause] });
    expect(dayKey("2026-10-01")).toHaveAccessibleName("jueves 1 de octubre: descanso (en pausa)");
    expect(screen.getByRole("button", { name: /^Pausas pasadas/ })).toHaveTextContent("1");
    // Paused today: no "Pausar".
    expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Reanudar: Del 30 de setiembre al 5 de octubre · Viaje",
      }),
    );
    expect(resumeHabit).toHaveBeenCalledWith({ id: ID, pauseId: "p1" });
    expect(screen.getByRole("heading", { level: 2, name: "Pausas" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Pausas pasadas/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    await server.answer();
    expect(within(notices()).getByText("«Leer» volvió a tus hábitos de hoy.")).toBeInTheDocument();
  });

  test("Archivar and Reactivar: the same key (focus stays), the days read only while archived", async () => {
    const user = userEvent.setup();
    renderDetail(habit());
    const key = screen.getByRole("button", { name: "Archivar" });
    await user.click(key);
    expect(archiveHabit).toHaveBeenCalledWith({ id: ID });
    expect(key).toHaveAccessibleName("Reactivar");
    expect(key).toHaveFocus();
    expect(document.querySelector("[data-habit-archived]")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(dayKey("2026-10-01")).toHaveAttribute("aria-disabled", "true");
    await server.answer();
    expect(within(notices()).getByText("«Leer» se archivó.")).toBeInTheDocument();

    await user.click(key);
    expect(unarchiveHabit).toHaveBeenCalledWith({ id: ID, position: "end" });
    expect(key).toHaveAccessibleName("Archivar");
    await server.answer();
    expect(within(notices()).getByText("«Leer» volvió a tus hábitos.")).toBeInTheDocument();
  });

  test("Eliminar asks first when it has logged days, then goes back to the list with Deshacer", async () => {
    const user = userEvent.setup();
    renderDetail(habit({ hasLogs: true }));
    await user.click(screen.getByRole("button", { name: "Eliminar hábito" }));
    expect(screen.getByRole("heading", { level: 3, name: "¿Eliminar «Leer»?" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "No, conservarlo" }));
    expect(screen.getByRole("button", { name: "Eliminar hábito" })).toHaveFocus();
    expect(deleteHabit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Eliminar hábito" }));
    await user.click(screen.getByRole("button", { name: "Sí, eliminar" }));
    expect(deleteHabit).toHaveBeenCalledWith({ id: ID });
    // A second press while it is on its way does nothing.
    await user.click(screen.getByRole("button", { name: "Eliminando…" }));
    expect(deleteHabit).toHaveBeenCalledTimes(1);
    await server.answer();
    expect(router.replace).toHaveBeenCalledWith(`/habits?deleted=${ID}`);
  });
});

describe("Semana", () => {
  const week = (values: Partial<HabitsWeek> = {}): HabitsWeek => ({
    monday: "2026-09-21",
    earliestStart: "2026-09-01",
    total: { done: 3, expected: 9 },
    rows: [
      {
        id: ID,
        name: "Leer",
        kind: "build",
        measure: "check",
        unit: null,
        area: null,
        compliance: { done: 3, expected: 7 },
        days: ["21", "22", "23", "24", "25", "26", "27"].map((day, index) => ({
          day: `2026-09-${day}`,
          status: index < 3 ? "done" : index === 3 ? "paused" : "empty",
          quantity: index < 3 ? 1 : 0,
          target: 1,
        })),
      },
    ],
    ...values,
  });

  function renderWeek(data: HabitsWeek) {
    render(
      <HabitsScreen today={TODAY} areas={[]}>
        <HabitsWeekView
          week={data}
          archived={[]}
          today={TODAY}
          headingId="habits-title"
          viewSwitch={null}
        />
      </HabitsScreen>,
    );
  }

  test("the total, each habit's row (a link to its page) and the days in words", () => {
    renderWeek(week());
    const total = document.querySelector("[data-week-total]")!;
    expect(total).toHaveTextContent("de 9");
    expect(total).toHaveTextContent("esa semana");
    expect(total).toHaveTextContent("Del 21 al 27 de setiembre");
    const list = screen.getByRole("list", { name: "Tus hábitos esta semana" });
    expect(within(list).getByRole("link", { name: "Leer" })).toHaveAttribute(
      "href",
      `/habits/${ID}`,
    );
    expect(document.querySelector("[data-week-compliance]")).toHaveTextContent("3 de 7");
    const days = within(list).getByRole("list", { name: "Días de «Leer»" });
    expect(
      within(days)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "lunes 21 de setiembre: hecho",
      "martes 22 de setiembre: hecho",
      "miércoles 23 de setiembre: hecho",
      "jueves 24 de setiembre: descanso (en pausa)",
      "viernes 25 de setiembre: sin marcar",
      "sábado 26 de setiembre: sin marcar",
      "domingo 27 de setiembre: sin marcar",
    ]);
  });

  test("week links: back to the first week, forward and to this week", () => {
    renderWeek(week());
    const nav = screen.getByRole("navigation", { name: "Cambiar de semana" });
    expect(within(nav).getByRole("link", { name: "Semana anterior" })).toHaveAttribute(
      "href",
      "/habits?vista=semana&semana=2026-09-14",
    );
    expect(within(nav).getByRole("link", { name: "Semana siguiente" })).toHaveAttribute(
      "href",
      "/habits?vista=semana&semana=2026-09-28",
    );
    expect(within(nav).getByRole("link", { name: "Volver a esta semana" })).toHaveAttribute(
      "href",
      "/habits?vista=semana",
    );
  });

  test("this week: no next week; the first week: no previous one", () => {
    renderWeek(week({ monday: "2026-09-28", earliestStart: "2026-09-29" }));
    expect(document.querySelector("[data-week-total]")).toHaveTextContent("esta semana");
    expect(screen.queryByRole("link", { name: "Semana anterior" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Semana siguiente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Volver a esta semana" })).not.toBeInTheDocument();
  });

  test("empty: without habits, the way to create one; a week before them, a plain note", () => {
    renderWeek(
      week({
        monday: "2026-09-28",
        rows: [],
        earliestStart: null,
        total: { done: 0, expected: 0 },
      }),
    );
    expect(screen.getByRole("link", { name: "Ir a Hoy" })).toHaveAttribute("href", "/habits");
  });
});

describe("Más detalles in the form", () => {
  function renderToday() {
    render(
      <HabitsScreen today={TODAY} areas={[]}>
        <HabitsToday habits={[]} headingId="habits-title" />
      </HabitsScreen>,
    );
  }

  test("folded; identity, cue and an earlier start date are sent", async () => {
    vi.mocked(createHabit).mockResolvedValue(ok(habit({ name: "Leer" })));
    const user = userEvent.setup();
    renderToday();
    await user.click(screen.getByRole("button", { name: "Crear un hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    const toggle = within(dialog).getByRole("button", { name: /Más detalles/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog).queryByRole("textbox", { name: "Identidad (opcional)" }),
    ).not.toBeInTheDocument();
    await user.click(toggle);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Identidad (opcional)" }),
      "Soy alguien que lee",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Momento (opcional)" }),
      "Antes de dormir",
    );
    const start = within(dialog).getByLabelText("Fecha de inicio");
    expect(start).toHaveValue(TODAY);
    expect(start).toHaveAttribute("min", "2026-09-25");
    expect(start).toHaveAttribute("max", TODAY);
    await user.clear(start);
    await user.type(start, "2026-09-29");
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Leer",
        identity: "Soy alguien que lee",
        cue: "Antes de dormir",
        startDate: "2026-09-29",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("a start date out of its window: the error on the field, focused (the section opens)", async () => {
    const user = userEvent.setup();
    renderToday();
    await user.click(screen.getByRole("button", { name: "Crear un hábito" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo hábito" });
    await user.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Leer");
    await user.click(within(dialog).getByRole("button", { name: /Más detalles/ }));
    const start = within(dialog).getByLabelText("Fecha de inicio");
    await user.clear(start);
    await user.type(start, "2026-09-01");
    // Fold it again: the error opens it.
    await user.click(within(dialog).getByRole("button", { name: /Más detalles/ }));
    await user.click(within(dialog).getByRole("button", { name: "Crear hábito" }));
    expect(createHabit).not.toHaveBeenCalled();
    const field = await within(dialog).findByLabelText("Fecha de inicio");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining(DETAILS_ERRORS.startDateTooEarly),
    );
  });
});
