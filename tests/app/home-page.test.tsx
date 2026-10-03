import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/(app)/page";
import { ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { getHabitsDueToday } from "@/modules/habits/contracts";
import type { HabitItem } from "@/modules/habits/habit-input";
import { setHabitDone } from "@/modules/habits/log-actions";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/habits/contracts", () => ({ getHabitsDueToday: vi.fn() }));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  logHabit: vi.fn(),
  setHabitQuantity: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  // 2026-09-30 08:15 in Lima (UTC-5).
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-30T13:15:00Z") });
  vi.mocked(requireOwner).mockReset();
  vi.mocked(requireOwner).mockResolvedValue({ user: { id: "owner-id" } } as never);
  vi.mocked(getHabitsDueToday).mockReset();
  vi.mocked(getHabitsDueToday).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test("home page greets in Lima time; passkeys and sign-out moved to Ajustes", async () => {
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "Buenos días" })).toBeInTheDocument();
  const date = screen.getByText("Miércoles, 30 de setiembre");
  expect(date.tagName).toBe("TIME");
  expect(date).toHaveAttribute("dateTime", "2026-09-30");
  expect(screen.queryByRole("heading", { name: /Passkeys/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cerrar sesión" })).toBeNull();
  expect(requireOwner).toHaveBeenCalled();
});

test("home page reads today's habits at the page's instant and shows the board", async () => {
  render(await Home());
  expect(getHabitsDueToday).toHaveBeenCalledTimes(1);
  expect(getHabitsDueToday).toHaveBeenCalledWith(new Date("2026-09-30T13:15:00Z"));
  // No habits today: the calm empty day.
  expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeInTheDocument();
});

test("home page does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
  // Nothing is read before the owner is known.
  expect(getHabitsDueToday).not.toHaveBeenCalled();
});

test("greeting and date follow Lima, not UTC, around midnight", async () => {
  // 2026-10-01 02:30 UTC is still 21:30 on September 30 in Lima.
  vi.setSystemTime(new Date("2026-10-01T02:30:00Z"));
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "Buenas noches" })).toBeInTheDocument();
  expect(screen.getByText("Miércoles, 30 de setiembre")).toBeInTheDocument();
});

test("a tap at 21:30 in Lima (02:30 UTC the next day) logs Lima's day", async () => {
  vi.setSystemTime(new Date("2026-10-01T02:30:00Z"));
  const meditar = {
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
  } satisfies HabitItem;
  vi.mocked(getHabitsDueToday).mockResolvedValue([meditar]);
  vi.mocked(setHabitDone).mockResolvedValue(ok({ ...meditar, quantity: 1 }));
  render(await Home());

  await userEvent.click(screen.getByRole("button", { name: "Meditar" }));
  await waitFor(() =>
    expect(setHabitDone).toHaveBeenCalledWith({ id: meditar.id, day: "2026-09-30", done: true }),
  );
});
