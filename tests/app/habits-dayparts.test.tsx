// R4 of `reminders`: the pads of «Hoy» grouped by franja, on the board (/) and on Hábitos → Hoy.
// With at least one franja the pads go under Mañana / Tarde / Noche and «Sin franja» last; with
// none the screen is exactly what it was (control: same single list, no band wrapper). The count
// and the pads' own behaviour don't change owner; focus follows a pad that leaves or that moves to
// another franja (its list is unmounted and mounted again) and never ends on <body>.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import type { HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
import { updateHabit } from "@/modules/habits/organize-actions";
import { skipHabitToday } from "@/modules/habits/skip-actions";
import { TodayBoard } from "@/modules/today/components/today-board";

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
vi.mock("@/modules/habits/skip-actions", () => ({
  skipHabitToday: vi.fn(),
  undoSkipHabit: vi.fn(),
}));

const NOW = new Date("2026-10-02T15:00:00.000Z");
const TODAY = ownerDateKey(NOW);

let serial = 0;
/** Habit names by id: the pads are read back by name. */
const known = new Map<string, string>();
function habit(values: Partial<HabitItem> = {}): HabitItem {
  serial += 1;
  const id = `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
  known.set(id, (values.name as string | undefined) ?? `Hábito ${serial}`);
  return {
    id,
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

const PLAIN = [habit({ name: "Leer" }), habit({ name: "Meditar" }), habit({ name: "Agua" })];
// The manual order is Leer, Estirar, Caminar, Meditar, Agua, Vitaminas; on screen it is Estirar,
// Vitaminas | Caminar | Meditar | Leer, Agua: «Leer» is first by hand and last on screen.
const GROUPED = [
  habit({ name: "Leer" }),
  habit({ name: "Estirar", daypart: "morning" }),
  habit({ name: "Caminar", daypart: "afternoon" }),
  habit({ name: "Meditar", daypart: "evening" }),
  habit({ name: "Agua" }),
  habit({ name: "Vitaminas", daypart: "morning" }),
];
const SCREEN_ORDER = ["Estirar", "Vitaminas", "Caminar", "Meditar", "Leer", "Agua"];

/** Resolvers of the actions that stay in flight, so an optimistic change is not rolled back. */
let inFlight: (() => void)[] = [];

beforeEach(() => {
  // Only Date is faked (timers stay real for userEvent): a tap checks it is still TODAY.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  inFlight = [];
  vi.mocked(setHabitDone).mockReset();
  vi.mocked(updateHabit).mockReset();
  vi.mocked(skipHabitToday)
    .mockReset()
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight.push(() => resolve({ ok: false, error: "x" }));
        }),
    );
});

afterEach(async () => {
  await act(async () => inFlight.forEach((resolve) => resolve()));
  vi.useRealTimers();
});

/** The names of the pads in a list, by their button (the pad is a toggle named after the habit). */
const padsIn = (list: HTMLElement) =>
  [...list.querySelectorAll<HTMLElement>("[data-habit-cell]")].map((cell) => {
    return known.get(cell.dataset.habitCell ?? "") ?? "?";
  });

const bandList = (label: string) =>
  screen.getByRole("list", { name: `Hábitos de la franja ${label}` });

describe("the board (/)", () => {
  function board(habits: HabitItem[]) {
    return render(
      <>
        <h1 id="today-title" tabIndex={-1}>
          Hoy
        </h1>
        <TodayBoard today={TODAY} habits={habits} />
      </>,
    );
  }

  test("without any franja it is the single list it always was", () => {
    const { container } = board(PLAIN);
    expect(screen.getByRole("list", { name: "Hábitos de hoy" })).toBeInTheDocument();
    expect(container.querySelector("[data-today-habit-bands]")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(padsIn(screen.getByRole("list", { name: "Hábitos de hoy" }))).toEqual([
      "Leer",
      "Meditar",
      "Agua",
    ]);
  });

  test("with a franja: Mañana, Tarde, Noche and «Sin franja» last, each with its pads in order", () => {
    const { container } = board(GROUPED);
    expect(screen.queryByRole("list", { name: "Hábitos de hoy" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Mañana",
      "Tarde",
      "Noche",
      "Sin franja",
    ]);
    expect(padsIn(bandList("mañana"))).toEqual(["Estirar", "Vitaminas"]);
    expect(padsIn(bandList("tarde"))).toEqual(["Caminar"]);
    expect(padsIn(bandList("noche"))).toEqual(["Meditar"]);
    expect(padsIn(screen.getByRole("list", { name: "Hábitos sin franja" }))).toEqual([
      "Leer",
      "Agua",
    ]);
    // The DOM order is the visual order (what a screen reader and the Tab key follow).
    expect(padsIn(container as unknown as HTMLElement)).toEqual(SCREEN_ORDER);
    // Every habit is still on the board exactly once, and the count says the same as before.
    expect(container.querySelectorAll("[data-habit-cell]")).toHaveLength(6);
    expect(document.querySelector("[data-today-habits-count]")).toHaveTextContent("0 de 6");
  });

  test("a paused habit, a rested one and a habit to avoid with a franja", () => {
    const paused = habit({
      name: "Pausado",
      daypart: "evening",
      pause: { id: "p", startDate: TODAY, endDate: TODAY, reason: null },
    });
    const avoid = habit({ name: "No fumar", kind: "avoid", daypart: "afternoon" });
    board([...GROUPED, paused, avoid]);
    // The paused one is not a pad (it rests); the one to avoid is a pad under its franja, with no corner key.
    expect(padsIn(bandList("noche"))).toEqual(["Meditar"]);
    expect(padsIn(bandList("tarde"))).toEqual(["Caminar", "No fumar"]);
    expect(
      within(bandList("tarde")).queryByRole("button", { name: "Opciones de «No fumar»" }),
    ).toBeNull();
    expect(document.querySelector("[data-today-habits-count]")).toHaveTextContent("1 de 7");
  });

  test("a pad under a franja still logs the day, shown at once", async () => {
    vi.mocked(setHabitDone).mockImplementation(
      () => new Promise((resolve) => inFlight.push(() => resolve(ok(GROUPED[3])))),
    );
    const user = userEvent.setup();
    board(GROUPED);
    const noche = bandList("noche");
    await user.click(within(noche).getByRole("button", { name: "Meditar" }));
    await waitFor(() =>
      expect(setHabitDone).toHaveBeenCalledWith(
        expect.objectContaining({ id: GROUPED[3].id, done: true }),
      ),
    );
    expect(within(noche).getByRole("button", { name: "Meditar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector("[data-today-habits-count]")).toHaveTextContent("1 de 6");
  });

  describe("focus when a pad leaves (skipping today): the neighbor on screen, not in the manual order", () => {
    async function skip(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
      const sheet = await screen.findByRole("dialog", { name });
      await user.click(within(sheet).getByRole("button", { name: "Saltar hoy" }));
    }

    test("the last of «Mañana» hands focus to the first of the next band", async () => {
      const user = userEvent.setup();
      board(GROUPED);
      await skip(user, "Vitaminas");
      // Manual order has nothing after «Vitaminas» (it would fall back to «Agua»).
      await waitFor(() =>
        expect(within(bandList("tarde")).getByRole("button", { name: "Caminar" })).toHaveFocus(),
      );
    });

    test("the only pad of a band goes to the next one on screen; its band disappears", async () => {
      const user = userEvent.setup();
      board(GROUPED);
      await skip(user, "Meditar");
      // Manual order would say «Agua»; on screen «Noche» is followed by «Sin franja», starting with «Leer».
      await waitFor(() =>
        expect(
          within(screen.getByRole("list", { name: "Hábitos sin franja" })).getByRole("button", {
            name: "Leer",
          }),
        ).toHaveFocus(),
      );
      expect(screen.queryByRole("list", { name: "Hábitos de la franja noche" })).toBeNull();
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "Mañana",
        "Tarde",
        "Sin franja",
      ]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("with the pad that stays in its band, the band keeps its heading and list", async () => {
      const user = userEvent.setup();
      board(GROUPED);
      await skip(user, "Estirar");
      await waitFor(() =>
        expect(within(bandList("mañana")).getByRole("button", { name: "Vitaminas" })).toHaveFocus(),
      );
      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    });
  });
});

describe("Hábitos → Hoy", () => {
  function screenOf(habits: HabitItem[]) {
    return render(
      <HabitsScreen today={TODAY} areas={[]}>
        <HabitsToday habits={habits} headingId="habits-title" />
      </HabitsScreen>,
    );
  }

  /** A page that re-renders with what the (mocked) update saved, like the revalidation. */
  let answers: (() => void)[] = [];
  function liveScreen(initial: HabitItem[]) {
    answers = [];
    let setData: (habits: HabitItem[]) => void = () => {};
    function Harness() {
      const [data, set] = useState(initial);
      useLayoutEffect(() => {
        setData = set;
      }, []);
      return (
        <HabitsScreen today={TODAY} areas={[]}>
          <HabitsToday habits={data} headingId="habits-title" />
        </HabitsScreen>
      );
    }
    // The save waits until the test answers it: then the page re-renders with it (the
    // revalidation) and the action resolves.
    vi.mocked(updateHabit).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          const { id, daypart } = input as { id: string; daypart?: HabitItem["daypart"] };
          const current = initial.find((item) => item.id === id) as HabitItem;
          const saved = { ...current, daypart: daypart === undefined ? current.daypart : daypart };
          answers.push(() => {
            initial = initial.map((item) => (item.id === id ? saved : item));
            setData(initial);
            resolve(ok(saved));
          });
        }),
    );
    return render(<Harness />);
  }

  async function editFranja(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    franja: string,
  ) {
    await user.click(screen.getByRole("button", { name: `Opciones de «${name}»` }));
    const options = await screen.findByRole("dialog", { name });
    await user.click(within(options).getByRole("button", { name: "Editar" }));
    const form = await screen.findByRole("dialog", { name: "Editar hábito" });
    await user.click(
      within(within(form).getByRole("radiogroup", { name: "Franja" })).getByRole("radio", {
        name: franja,
      }),
    );
    await user.click(within(form).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers.shift()?.());
  }

  test("without any franja there is one grid and no band", () => {
    const { container } = screenOf(PLAIN);
    expect(container.querySelectorAll("[data-habits-grid='due']")).toHaveLength(1);
    expect(container.querySelector("[data-habits-bands]")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  test("with a franja the due pads are grouped, each in exactly one band, in screen order", () => {
    const { container } = screenOf(GROUPED);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Mañana",
      "Tarde",
      "Noche",
      "Sin franja",
    ]);
    expect(
      [...container.querySelectorAll("[data-habits-band]")].map((band) =>
        band.getAttribute("data-habits-band"),
      ),
    ).toEqual(["morning", "afternoon", "evening", "none"]);
    expect(padsIn(bandList("mañana"))).toEqual(["Estirar", "Vitaminas"]);
    expect(padsIn(bandList("tarde"))).toEqual(["Caminar"]);
    expect(padsIn(bandList("noche"))).toEqual(["Meditar"]);
    expect(padsIn(screen.getByRole("list", { name: "Hábitos sin franja" }))).toEqual([
      "Leer",
      "Agua",
    ]);
    expect(padsIn(container as unknown as HTMLElement)).toEqual(SCREEN_ORDER);
    expect(screen.getByText("0 de 6 hoy")).toBeInTheDocument();
  });

  test("changing a habit's franja moves its pad to the new list and keeps focus on it", async () => {
    const user = userEvent.setup();
    liveScreen(GROUPED);
    await editFranja(user, "Leer", "Noche");
    await waitFor(() => expect(padsIn(bandList("noche"))).toEqual(["Leer", "Meditar"]));
    await waitFor(() => expect(bandList("noche").contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toHaveAccessibleName("Leer");
    expect(document.activeElement).not.toBe(document.body);
  });

  test("putting a franja on the only habit turns the plain grid into bands and keeps focus", async () => {
    const user = userEvent.setup();
    const { container } = liveScreen([habit({ name: "Leer" })]);
    expect(container.querySelector("[data-habits-bands]")).toBeNull();
    await editFranja(user, "Leer", "Mañana");
    await waitFor(() => expect(container.querySelector("[data-habits-bands]")).not.toBeNull());
    await waitFor(() => expect(bandList("mañana").contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toHaveAccessibleName("Leer");
  });

  test("taking the last franja away turns the bands back into the plain grid and keeps focus", async () => {
    const user = userEvent.setup();
    const { container } = liveScreen([habit({ name: "Leer", daypart: "evening" })]);
    expect(container.querySelector("[data-habits-bands]")).not.toBeNull();
    await editFranja(user, "Leer", "Sin franja");
    await waitFor(() => expect(container.querySelector("[data-habits-bands]")).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Hábitos de hoy" }).contains(document.activeElement),
      ).toBe(true),
    );
    expect(document.activeElement).toHaveAccessibleName("Leer");
  });
});
