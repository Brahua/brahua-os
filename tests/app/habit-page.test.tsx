// H5 of `habits`: a habit's page (/habits/[id]) as a Server Component: the owner check, its
// title (and the 404's), the month asked for (`?mes=`) and the redirect to the month shown, and
// the month links. The page's parts are tested in habits-history.test.tsx.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HabitPage, { generateMetadata } from "@/app/(app)/habits/[id]/page";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import type { HabitItem } from "@/modules/habits/habit-input";
import type { LoadedHabit } from "@/modules/habits/habits";
import { getHabitDetail } from "@/modules/habits/queries";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: navigation.redirect,
  notFound: navigation.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@number-flow/react", () => ({ default: ({ value }: { value: number }) => <>{value}</> }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/core/queries", () => ({ listLifeAreas: vi.fn() }));
vi.mock("@/modules/habits/queries", () => ({ getHabitDetail: vi.fn() }));
vi.mock("@/modules/habits/actions", () => ({ deleteHabit: vi.fn(), createHabit: vi.fn() }));
vi.mock("@/modules/habits/log-actions", () => ({
  setHabitDone: vi.fn(),
  setHabitQuantity: vi.fn(),
}));
vi.mock("@/modules/habits/organize-actions", () => ({
  archiveHabit: vi.fn(),
  unarchiveHabit: vi.fn(),
  updateHabit: vi.fn(),
}));
vi.mock("@/modules/habits/pause-actions", () => ({
  pauseHabit: vi.fn(),
  resumeHabit: vi.fn(),
  removeHabitPause: vi.fn(),
}));

const ID = "00000000-0000-4000-8000-000000000001";
// Friday 2026-10-02, 10:00 in Lima.
const NOW = new Date("2026-10-02T15:00:00.000Z");

const item: HabitItem = {
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
  startDate: "2026-08-20",
  area: null,
  quantity: 0,
  target: 1,
  hasLogs: false,
  weekDoneBefore: 0,
  weekAvailable: 7,
  streak: { unit: "days", done: 1, notDone: 0 },
  pause: null,
  recentLogs: [],
  recentPaused: [],
  identity: null,
  cue: null,
};
const LOADED: LoadedHabit = { item, archived: false, logs: [], pauses: [] };

const props = (mes?: string | string[]) => ({
  params: Promise.resolve({ id: ID }),
  searchParams: Promise.resolve(mes === undefined ? {} : { mes }),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  navigation.redirect.mockClear();
  navigation.notFound.mockClear();
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(listLifeAreas).mockReset().mockResolvedValue([]);
  vi.mocked(getHabitDetail).mockReset().mockResolvedValue(LOADED);
});

describe("/habits/[id]", () => {
  test("owner check; today's month by default; the title is the habit's", async () => {
    expect((await generateMetadata(props())).title).toBe("Leer · Hábitos · brahua-os");
    render(await HabitPage(props()));
    expect(requireOwner).toHaveBeenCalled();
    expect(getHabitDetail).toHaveBeenCalledWith(ID, "2026-10", "2026-10-02");
    expect(screen.getByRole("heading", { level: 1, name: "Leer" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: /Octubre de 2026/ })).toBeInTheDocument();
    const months = screen.getByRole("navigation", { name: "Cambiar de mes" });
    expect(within(months).getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
      "href",
      `/habits/${ID}?mes=2026-09`,
    );
    expect(within(months).queryByRole("link", { name: "Mes siguiente" })).not.toBeInTheDocument();
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  test("a month in range is read and shown, with both links", async () => {
    render(await HabitPage(props("2026-09")));
    expect(getHabitDetail).toHaveBeenCalledWith(ID, "2026-09", "2026-10-02");
    expect(screen.getByRole("grid", { name: /Setiembre de 2026/ })).toBeInTheDocument();
    const months = screen.getByRole("navigation", { name: "Cambiar de mes" });
    expect(within(months).getByRole("link", { name: "Mes siguiente" })).toHaveAttribute(
      "href",
      `/habits/${ID}`,
    );
    // August is its first month: still back there.
    expect(within(months).getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
      "href",
      `/habits/${ID}?mes=2026-08`,
    );
  });

  test.each([
    ["before the start: its first month", "2025-01", `/habits/${ID}?mes=2026-08`],
    ["later than today: today's month", "2030-01", `/habits/${ID}`],
    ["not a month: today's month", "2026-13", `/habits/${ID}`],
    ["today's month itself: the bare page", "2026-10", `/habits/${ID}`],
    ["a list: today's month", ["2026-08", "2026-09"], `/habits/${ID}`],
  ])("?mes= %s → redirect", async (_, mes, url) => {
    await expect(HabitPage(props(mes))).rejects.toThrow(`redirect:${url}`);
  });

  test("missing, deleted or malformed: a 404 with its own title, not indexed", async () => {
    vi.mocked(getHabitDetail).mockResolvedValue(null);
    expect(await generateMetadata(props())).toEqual({
      title: "Hábito no encontrado · brahua-os",
      robots: { index: false, follow: false },
    });
    await expect(HabitPage(props())).rejects.toThrow("notFound");
    expect(requireOwner).toHaveBeenCalled();
  });
});
