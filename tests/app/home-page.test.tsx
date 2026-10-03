import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/(app)/page";
import { requireOwner } from "@/lib/auth";
import { getHabitsDueToday } from "@/modules/habits/contracts";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/habits/contracts", () => ({ getHabitsDueToday: vi.fn() }));
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
