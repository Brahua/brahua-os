// `health` E4 against a fake server (actions mocked; the queue, notices and focus are the real
// ones): «Ajustes» (the linked habit, «Ninguno», «(ya no existe)», a save and a refusal), Hoy's
// «Entreno» card (running with its minutes and «Seguir», «Empezar Rutina B» that starts and opens
// the session, «Ver entreno» for another routine, nothing at all), and the «Terminar» notice that names the habit.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { SessionScreen } from "@/modules/health/components/session-screen";
import { SettingsRow } from "@/modules/health/components/settings-sheet";
import type { HealthTodaySummary } from "@/modules/health/contracts";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { finishHealthSession, startHealthSession } from "@/modules/health/sessions-actions";
import { SESSIONS_COPY } from "@/modules/health/sessions-copy";
import type { SessionDetail } from "@/modules/health/sessions-input";
import { updateHealthSettings } from "@/modules/health/settings-actions";
import { SETTINGS_COPY as COPY, SETTINGS_ERRORS } from "@/modules/health/settings-copy";
import type { HealthSettingsView } from "@/modules/health/settings-input";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayTraining, trainingCount } from "@/modules/today/components/today-training";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/modules/health/settings-actions", () => ({ updateHealthSettings: vi.fn() }));
vi.mock("@/modules/health/sessions-actions", () => ({
  startHealthSession: vi.fn(),
  addSessionExercise: vi.fn(),
  removeSessionExercise: vi.fn(),
  restoreSessionExercise: vi.fn(),
  reorderSessionExercises: vi.fn(),
  addHealthSet: vi.fn(),
  updateHealthSet: vi.fn(),
  removeHealthSet: vi.fn(),
  restoreHealthSet: vi.fn(),
  updateSessionNote: vi.fn(),
  updateSessionTimes: vi.fn(),
  finishHealthSession: vi.fn(),
  undoFinishHealthSession: vi.fn(),
  deleteHealthSession: vi.fn(),
  restoreHealthSession: vi.fn(),
  readHealthSessionRecords: vi.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GYM = { id: id(20), name: "Gimnasio" };
const READ = { id: id(21), name: "Leer" };
// The board refuses nothing on its own day: Lima's real today.
const TODAY = ownerDateKey(new Date());

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

function Settings({ view }: { view: HealthSettingsView }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <ul>
        <SettingsRow view={view} />
      </ul>
    </ScreenServicesProvider>
  );
}

const notices = () => screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
const row = () => screen.getByRole("button", { name: new RegExp(`^${COPY.link}`) });

describe("«Ajustes»", () => {
  test("links a habit: the options, the save, the notice and focus back on the row", async () => {
    vi.mocked(updateHealthSettings).mockResolvedValue(
      ok({ habitId: GYM.id, options: [GYM, READ] }),
    );
    render(<Settings view={{ habitId: null, options: [GYM, READ] }} />);
    expect(row()).toHaveTextContent(COPY.linkHelp(null, false));

    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: COPY.title });
    const select = within(sheet).getByRole("combobox", { name: COPY.habitLabel });
    expect(select).toHaveValue("");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([COPY.none, "Gimnasio", "Leer"]);
    await userEvent.selectOptions(select, GYM.id);
    await userEvent.click(within(sheet).getByRole("button", { name: HEALTH_COPY.save }));

    expect(updateHealthSettings).toHaveBeenCalledWith({ habitId: GYM.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(notices()).findByText(COPY.saved("Gimnasio"))).toBeVisible();
    expect(row()).toHaveTextContent(COPY.linkHelp("Gimnasio", false));
    await waitFor(() => expect(row()).toHaveFocus());
  });

  test("«Ninguno» unlinks it; an unchanged choice saves nothing", async () => {
    vi.mocked(updateHealthSettings).mockResolvedValue(ok({ habitId: null, options: [GYM] }));
    render(<Settings view={{ habitId: GYM.id, options: [GYM] }} />);
    await userEvent.click(row());
    let sheet = await screen.findByRole("dialog", { name: COPY.title });
    await userEvent.click(within(sheet).getByRole("button", { name: HEALTH_COPY.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateHealthSettings).not.toHaveBeenCalled();

    await userEvent.click(row());
    sheet = await screen.findByRole("dialog", { name: COPY.title });
    await userEvent.selectOptions(
      within(sheet).getByRole("combobox", { name: COPY.habitLabel }),
      "",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: HEALTH_COPY.save }));
    expect(updateHealthSettings).toHaveBeenCalledWith({ habitId: null });
    expect(await within(notices()).findByText(COPY.saved(null))).toBeVisible();
  });

  test("a habit that no longer exists reads «(ya no existe)»", async () => {
    render(<Settings view={{ habitId: id(99), options: [GYM] }} />);
    expect(row()).toHaveTextContent(COPY.linkHelp(null, true));
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: COPY.title });
    const select = within(sheet).getByRole("combobox", { name: COPY.habitLabel });
    expect(select).toHaveValue(id(99));
    expect(within(select).getByRole("option", { name: COPY.missing })).toBeInTheDocument();
  });

  test("a newer read from the server replaces what the last save showed", async () => {
    vi.mocked(updateHealthSettings).mockResolvedValue(ok({ habitId: GYM.id, options: [GYM] }));
    const { rerender } = render(<Settings view={{ habitId: null, options: [GYM, READ] }} />);
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: COPY.title });
    await userEvent.selectOptions(
      within(sheet).getByRole("combobox", { name: COPY.habitLabel }),
      GYM.id,
    );
    await userEvent.click(within(sheet).getByRole("button", { name: HEALTH_COPY.save }));
    await waitFor(() => expect(row()).toHaveTextContent(COPY.linkHelp("Gimnasio", false)));
    // Another device linked «Leer» meanwhile: the revalidated page says so.
    rerender(<Settings view={{ habitId: READ.id, options: [GYM, READ] }} />);
    expect(row()).toHaveTextContent(COPY.linkHelp("Leer", false));
    expect(row()).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("a refusal keeps the sheet open with the reason", async () => {
    vi.mocked(updateHealthSettings).mockResolvedValue(fail(SETTINGS_ERRORS.habitUnavailable));
    render(<Settings view={{ habitId: null, options: [GYM] }} />);
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: COPY.title });
    await userEvent.selectOptions(
      within(sheet).getByRole("combobox", { name: COPY.habitLabel }),
      GYM.id,
    );
    await userEvent.click(within(sheet).getByRole("button", { name: HEALTH_COPY.save }));
    expect(
      await within(sheet).findByText(`${COPY.notSaved} ${SETTINGS_ERRORS.habitUnavailable}`),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: COPY.title })).toBeVisible();
  });
});

function Board({ summary }: { summary: HealthTodaySummary }) {
  return (
    <TodayBoard
      today={TODAY}
      habits={[]}
      training={{ count: trainingCount(summary), content: <TodayTraining summary={summary} /> }}
    />
  );
}

const training = () => screen.getByRole("region", { name: "Entreno" });

describe("Hoy's «Entreno»", () => {
  test("a session open: «Entreno en curso · Rutina A · 23 min» and «Seguir»", async () => {
    const startedAt = new Date(Date.now() - 23 * 60_000 - 5_000).toISOString();
    render(
      <Board
        summary={{
          running: { id: id(1), routineName: "Rutina A", startedAt },
          next: null,
          habitDue: false,
        }}
      />,
    );
    expect(within(training()).getByText("Entreno en curso")).toBeVisible();
    expect(await within(training()).findByText("Rutina A · 23 min")).toBeVisible();
    expect(within(training()).getByRole("link", { name: "Seguir con Rutina A" })).toHaveAttribute(
      "href",
      `/health/sessions/${id(1)}`,
    );
    expect(screen.queryByRole("heading", { name: "Nada programado para hoy" })).toBeNull();
  });

  test("the habit due: «Empezar Rutina B» starts and opens it; «Ver entreno» goes to /health", async () => {
    vi.mocked(startHealthSession).mockResolvedValue(ok({ started: true, id: id(5) }));
    render(
      <Board
        summary={{
          running: null,
          next: { routineId: id(2), routineName: "Rutina B" },
          habitDue: true,
        }}
      />,
    );
    expect(within(training()).getByRole("link", { name: "Ver entreno" })).toHaveAttribute(
      "href",
      "/health",
    );
    await userEvent.click(within(training()).getByRole("button", { name: "Empezar Rutina B" }));
    expect(startHealthSession).toHaveBeenCalledWith({ routineId: id(2) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/health/sessions/${id(5)}`));
  });

  test("a session already open elsewhere: «Ya tienes un entreno en curso», nothing opens", async () => {
    vi.mocked(startHealthSession).mockResolvedValue(ok({ started: false, openId: id(6) }));
    render(
      <Board
        summary={{
          running: null,
          next: { routineId: id(2), routineName: "Rutina B" },
          habitDue: true,
        }}
      />,
    );
    await userEvent.click(within(training()).getByRole("button", { name: "Empezar Rutina B" }));
    const board = screen.getByRole("region", { name: "Avisos" });
    expect(await within(board).findByText("Ya tienes un entreno en curso.")).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  test("nothing to show: no section, and the day is empty", () => {
    render(
      <Board
        summary={{
          running: null,
          next: { routineId: id(2), routineName: "Rutina B" },
          habitDue: false,
        }}
      />,
    );
    expect(screen.queryByRole("region", { name: "Entreno" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Nada programado para hoy" })).toBeVisible();
  });
});

describe("«Terminar» with the linked habit", () => {
  const detail: SessionDetail = {
    id: id(1),
    routineId: id(50),
    routineName: "Rutina A",
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    endedAt: null,
    note: null,
    updatedAt: "2026-11-04T18:00:00.000Z",
    exercises: [
      {
        id: id(200),
        exerciseId: id(100),
        name: "Sentadilla con barra",
        kind: "weight_reps",
        equipment: "barbell",
        perDumbbell: false,
        restSeconds: 120,
        exerciseRestSeconds: 90,
        position: 0,
        previous: [],
        sets: [
          {
            id: id(300),
            position: 0,
            weightGrams: 80_000,
            reps: 8,
            seconds: null,
            distanceMeters: null,
            warmup: false,
            doneAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };

  test.each([
    ["Gimnasio", true],
    [null, false],
  ])(
    "the notice names the habit only when this «Terminar» marked it (%s)",
    async (habit, named) => {
      vi.mocked(finishHealthSession).mockResolvedValue(
        ok({
          id: id(1),
          endedAt: new Date().toISOString(),
          updatedAt: "2026-11-04T19:00:00.123Z",
          removedSetIds: [],
          records: [],
          habitMarked: habit,
        }),
      );
      render(
        <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
          <SessionScreen session={detail} catalogue={[]} headingId="session-title" />
        </ScreenServicesProvider>,
      );
      await userEvent.click(screen.getByRole("button", { name: SESSIONS_COPY.finish }));
      const sheet = await screen.findByRole("dialog", { name: SESSIONS_COPY.finishTitle });
      await userEvent.click(
        within(sheet).getByRole("button", { name: SESSIONS_COPY.finishConfirm }),
      );
      expect(await within(notices()).findByText(SESSIONS_COPY.finishedTitle)).toBeVisible();
      const marked = within(notices()).queryByText(/Marcaste «Gimnasio»\./);
      if (named) expect(marked).toBeVisible();
      else expect(marked).toBeNull();
    },
  );
});
