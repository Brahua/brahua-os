// R4 of `reminders`: the pads of «Hoy» grouped by franja, on the board (/) and on Hábitos → Hoy.
// With at least one franja the pads go under Mañana / Tarde / Noche and «Sin franja» last; with
// none the screen is exactly what it was (control: same single list, no band wrapper). The count
// and the pads' own behaviour don't change owner.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ownerDateKey } from "@/lib/time";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import type { HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";
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

const PLAIN = [habit({ name: "Leer" }), habit({ name: "Meditar" }), habit({ name: "Agua" })];
const GROUPED = [
  habit({ name: "Leer" }),
  habit({ name: "Estirar", daypart: "morning" }),
  habit({ name: "Caminar", daypart: "afternoon" }),
  habit({ name: "Meditar", daypart: "evening" }),
  habit({ name: "Agua" }),
  habit({ name: "Vitaminas", daypart: "morning" }),
];

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
  vi.mocked(setHabitDone).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(container.querySelectorAll("[data-habit-cell]")).toHaveLength(3);
  });

  test("with a franja: Mañana, Tarde, Noche and «Sin franja» last, each with its pads", () => {
    const { container } = board(GROUPED);
    expect(screen.queryByRole("list", { name: "Hábitos de hoy" })).toBeNull();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Mañana", "Tarde", "Noche", "Sin franja"]);
    const cellsOf = (label: string) =>
      [...screen.getByRole("list", { name: label }).querySelectorAll("[data-habit-cell]")].map(
        (cell) => cell.textContent,
      );
    expect(cellsOf("Mañana")).toHaveLength(2);
    expect(cellsOf("Mañana").join("|")).toMatch(/Estirar.*\|.*Vitaminas/);
    expect(cellsOf("Tarde").join("|")).toMatch(/Caminar/);
    expect(cellsOf("Noche").join("|")).toMatch(/Meditar/);
    expect(cellsOf("Sin franja").join("|")).toMatch(/Leer.*\|.*Agua/);
    // Every habit is still on the board exactly once, and the count says the same as before.
    expect(container.querySelectorAll("[data-habit-cell]")).toHaveLength(6);
    expect(document.querySelector("[data-today-habits-count]")).toHaveTextContent("0 de 6");
  });

  test("a pad under a franja still logs the day", async () => {
    vi.mocked(setHabitDone).mockResolvedValue({
      ok: true,
      data: habit({ name: "Meditar", daypart: "evening", quantity: 1 }),
    });
    const user = userEvent.setup();
    board(GROUPED);
    const noche = screen.getByRole("list", { name: "Noche" });
    await user.click(within(noche).getByRole("button", { name: "Meditar" }));
    await waitFor(() =>
      expect(setHabitDone).toHaveBeenCalledWith(
        expect.objectContaining({ id: GROUPED[3].id, done: true }),
      ),
    );
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

  test("without any franja there is one grid and no band", () => {
    const { container } = screenOf(PLAIN);
    expect(container.querySelectorAll("[data-habits-grid='due']")).toHaveLength(1);
    expect(container.querySelector("[data-habits-bands]")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  test("with a franja the due pads are grouped; every pad is in exactly one band", () => {
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
    expect(container.querySelectorAll("[data-habit-cell]")).toHaveLength(6);
    expect(screen.getByText("0 de 6 hoy")).toBeInTheDocument();
  });
});
