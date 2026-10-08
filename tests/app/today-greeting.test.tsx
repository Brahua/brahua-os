// greeting-variants: the line under the greeting of "/", inside the real board. It renders, it is
// static text (no live region of its own), it follows the live tally, and it is empty (but keeps
// its paragraph and height) on a finished or an empty day.
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { HabitItem } from "@/modules/habits/habit-input";
import { GreetingLine } from "@/modules/today/components/greeting-line";
import { TodayBoard } from "@/modules/today/components/today-board";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const TODAY = "2026-10-02";

function habit(values: Partial<HabitItem> = {}): HabitItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Meditar",
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

const line = () => document.querySelector<HTMLElement>("[data-greeting-line]")!;

function board(habits: HabitItem[]) {
  return render(
    <TodayBoard
      today={TODAY}
      header={<GreetingLine part="morning" />}
      habits={habits}
      tasks={{ count: 0, content: null }}
      dayComplete={{ tasksDoneToday: 0 }}
    />,
  );
}

describe("GreetingLine", () => {
  test("shows a line when the day has things and nothing is done", () => {
    board([habit()]);
    expect(line().textContent).not.toBe("");
  });

  test("is static text: no live region on it or around it", () => {
    board([habit()]);
    expect(line().closest("[aria-live]")).toBeNull();
    expect(line().getAttribute("aria-live")).toBeNull();
    expect(line().getAttribute("role")).toBeNull();
  });

  test("shows a line when something is done and the day goes on", () => {
    board([habit({ quantity: 1 }), habit({ id: "00000000-0000-4000-8000-000000000002" })]);
    expect(line().textContent).not.toBe("");
    expect(screen.queryByRole("region", { name: "Día completo" })).toBeNull();
  });

  test("is empty on a finished day (Día completo says it) and keeps its paragraph", () => {
    board([habit({ quantity: 1 })]);
    expect(screen.getByRole("region", { name: "Día completo" })).toBeTruthy();
    expect(line().textContent).toBe("");
  });

  test("is empty on an empty day", () => {
    board([]);
    expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeTruthy();
    expect(line().textContent).toBe("");
  });

  test("renders nothing outside a board", () => {
    render(<GreetingLine part="evening" />);
    expect(line().textContent).toBe("");
  });
});
