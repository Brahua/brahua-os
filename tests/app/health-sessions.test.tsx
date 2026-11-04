// `health` E2: the session screen against a fake server (actions mocked; the queue, notices,
// announcer and focus are the real ones): «La vez pasada», a set marked in one tap with the rest
// bar, marking without values, typing a weight, a refusal rolled back, a network failure with
// «Sin guardar» and «Reintentar», «Añadir serie», removing a set with «Deshacer», «Terminar» and
// its «Deshacer», discarding; the rest bar on its own (±15 s, zero, reload, storage that throws,
// cleanup); the top of /health and the pages (queries mocked).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HealthPage from "@/app/(app)/health/page";
import SessionPage, { generateMetadata } from "@/app/(app)/health/sessions/[id]/page";
import SessionsPage from "@/app/(app)/health/sessions/page";
import { fail, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { RestBar, useRestTimer } from "@/modules/health/components/rest-bar";
import { SessionScreen } from "@/modules/health/components/session-screen";
import { SessionStart } from "@/modules/health/components/session-start";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import {
  getDeletedSession,
  getNextRoutine,
  getOpenSession,
  getSession,
  listExercises,
  listRoutines,
  listSessions,
} from "@/modules/health/queries";
import {
  addHealthSet,
  deleteHealthSession,
  finishHealthSession,
  removeHealthSet,
  restoreHealthSet,
  startHealthSession,
  undoFinishHealthSession,
  updateHealthSet,
} from "@/modules/health/sessions-actions";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "@/modules/health/sessions-copy";
import type {
  SessionDetail,
  SessionExercise,
  SessionSet,
  SessionSummary,
} from "@/modules/health/sessions-input";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/health/queries", () => ({
  listRoutines: vi.fn(),
  getDeletedRoutine: vi.fn(async () => null),
  listExercises: vi.fn(),
  getSession: vi.fn(),
  getOpenSession: vi.fn(),
  getNextRoutine: vi.fn(),
  listSessions: vi.fn(),
  getDeletedSession: vi.fn(async () => null),
}));
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
}));
vi.mock("@/modules/health/routines-actions", () => ({
  createRoutine: vi.fn(),
  renameRoutine: vi.fn(),
  deleteRoutine: vi.fn(),
  restoreRoutine: vi.fn(),
  reorderRoutines: vi.fn(),
  addRoutineItem: vi.fn(),
  updateRoutineItem: vi.fn(),
  removeRoutineItem: vi.fn(),
  restoreRoutineItem: vi.fn(),
  reorderRoutineItems: vi.fn(),
}));
vi.mock("@/modules/health/exercises-actions", () => ({
  createExercise: vi.fn(),
  restoreExercise: vi.fn(),
}));

const SQUAT = "Sentadilla con barra";
const serie = (index: number) => COPY.setName(index, SQUAT);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(1);

const set = (n: number, values: Partial<SessionSet> = {}): SessionSet => ({
  id: id(300 + n),
  position: n,
  weightGrams: null,
  reps: null,
  seconds: null,
  distanceMeters: null,
  warmup: false,
  doneAt: null,
  ...values,
});

const squat = (sets: SessionSet[]): SessionExercise => ({
  id: id(200),
  exerciseId: id(100),
  name: "Sentadilla con barra",
  kind: "weight_reps",
  equipment: "barbell",
  perDumbbell: false,
  restSeconds: 120,
  exerciseRestSeconds: 90,
  position: 0,
  sets,
  previous: [
    { weightGrams: 80_000, reps: 8, seconds: null, distanceMeters: null },
    { weightGrams: 80_000, reps: 8, seconds: null, distanceMeters: null },
  ],
});

const session = (exercises: SessionExercise[], values: Partial<SessionDetail> = {}) => ({
  id: SESSION,
  routineId: id(50),
  routineName: "Rutina A",
  startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  endedAt: null,
  note: null,
  updatedAt: "2026-11-04T18:00:00.000Z",
  exercises,
  ...values,
});

const PLANNED = [
  set(0, { weightGrams: 80_000, reps: 8 }),
  set(1, { weightGrams: 82_500, reps: 6 }),
];

function Screen({ detail }: { detail: SessionDetail }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <SessionScreen session={detail} catalogue={[]} headingId="session-title" />
    </ScreenServicesProvider>
  );
}

const check = (setId: string) =>
  document.querySelector<HTMLInputElement>(`[data-set-check="${setId}"]`)!;
const rowOf = (setId: string) => document.querySelector<HTMLElement>(`[data-set="${setId}"]`)!;
const restBar = () => screen.queryByRole("region", { name: COPY.restRegion });

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  vi.mocked(requireOwner).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the session screen", () => {
  test("«La vez pasada», one tap marks a set and the rest starts; «Saltar» gives focus back", async () => {
    vi.mocked(updateHealthSet).mockImplementation(async (input) => {
      const { done, ...values } = input as SessionSet & { done: boolean };
      return ok({ ...PLANNED[0], ...values, doneAt: done ? "2026-11-04T18:10:00.000Z" : null });
    });
    render(<Screen detail={session([squat(PLANNED)])} />);
    expect(screen.getByText(`${COPY.previous("80 kg × 8 · 80 × 8")}`)).toBeVisible();
    expect(screen.getByRole("textbox", { name: COPY.weightName(serie(0)) })).toHaveValue("80");
    expect(screen.getByRole("textbox", { name: COPY.weightName(serie(1)) })).toHaveValue("82,5");

    await userEvent.click(check(PLANNED[0].id));
    expect(updateHealthSet).toHaveBeenCalledWith({
      sessionId: SESSION,
      id: PLANNED[0].id,
      weightGrams: 80_000,
      reps: 8,
      seconds: null,
      distanceMeters: null,
      warmup: false,
      done: true,
    });
    expect(check(PLANNED[0].id)).toBeChecked();
    // The bar never takes focus.
    const bar = await screen.findByRole("region", { name: COPY.restRegion });
    expect(within(bar).getByRole("timer")).toHaveTextContent(/^(2:00|1:59)$/);
    expect(check(PLANNED[0].id)).toHaveFocus();
    expect(document.documentElement.style.getPropertyValue("--rest-bar-offset")).not.toBe("");

    await userEvent.click(within(bar).getByRole("button", { name: COPY.restSkipName }));
    await waitFor(() => expect(restBar()).toBeNull());
    expect(check(PLANNED[0].id)).toHaveFocus();
    expect(document.documentElement.style.getPropertyValue("--rest-bar-offset")).toBe("");
  });

  test("marking without its values asks for them first and sends nothing", async () => {
    const empty = set(0);
    render(<Screen detail={session([squat([empty])])} />);
    await userEvent.click(check(empty.id));
    expect(updateHealthSet).not.toHaveBeenCalled();
    expect(check(empty.id)).not.toBeChecked();
    const weight = screen.getByRole("textbox", { name: COPY.weightName(serie(0)) });
    expect(weight).toHaveFocus();
    expect(weight).toHaveAccessibleDescription(SESSION_ERRORS.missing.weightGrams);
    expect(restBar()).toBeNull();
  });

  test("a typed weight is saved in grams; a text that isn't one waits and says why", async () => {
    vi.mocked(updateHealthSet).mockImplementation(async (input) =>
      ok({ ...PLANNED[1], ...(input as Partial<SessionSet>), doneAt: null }),
    );
    render(<Screen detail={session([squat(PLANNED)])} />);
    const weight = screen.getByRole("textbox", { name: COPY.weightName(serie(1)) });
    await userEvent.clear(weight);
    await userEvent.type(weight, "85,25");
    await waitFor(() =>
      expect(updateHealthSet).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: PLANNED[1].id, weightGrams: 85_250, reps: 6, done: false }),
      ),
    );
    vi.mocked(updateHealthSet).mockClear();
    await userEvent.clear(weight);
    await userEvent.type(weight, "85,3");
    await userEvent.tab();
    expect(weight).toHaveAccessibleDescription(SESSION_ERRORS.weight);
    expect(updateHealthSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ weightGrams: 85_300 }),
    );
  });

  test("a refusal rolls the set back and says why", async () => {
    vi.mocked(updateHealthSet).mockResolvedValue(fail(SESSION_ERRORS.notOpen));
    render(<Screen detail={session([squat(PLANNED)])} />);
    await userEvent.click(check(PLANNED[0].id));
    // The rollback can land after the notice: assert it inside waitFor (CLAUDE.md "tasks").
    await waitFor(() => expect(check(PLANNED[0].id)).not.toBeChecked());
    const notices = screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
    await waitFor(() =>
      expect(within(notices).getByText(new RegExp(COPY.notSaved.set))).toBeVisible(),
    );
  });

  test("a network failure keeps the set as typed, «Sin guardar», and «Reintentar» sends it again", async () => {
    vi.mocked(updateHealthSet).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(updateHealthSet).mockImplementation(async () =>
      ok({ ...PLANNED[0], doneAt: "2026-11-04T18:10:00.000Z" }),
    );
    render(<Screen detail={session([squat(PLANNED)])} />);
    await userEvent.click(check(PLANNED[0].id));
    const retry = await screen.findByRole("button", { name: COPY.retryName(0, SQUAT) });
    expect(check(PLANNED[0].id)).toBeChecked();
    expect(within(rowOf(PLANNED[0].id)).getByText(COPY.unsaved)).toBeVisible();
    await userEvent.click(retry);
    await waitFor(() => expect(updateHealthSet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(rowOf(PLANNED[0].id)).queryByText(COPY.unsaved)).toBeNull());
    expect(check(PLANNED[0].id)).toBeChecked();
  });

  test("«Añadir serie» copies the last one; removing a set offers «Deshacer»", async () => {
    vi.mocked(addHealthSet).mockImplementation(async (input) =>
      ok({ ...set(2), ...(input as Partial<SessionSet>) }),
    );
    vi.mocked(removeHealthSet).mockResolvedValue(ok({ id: PLANNED[0].id, position: 0 }));
    vi.mocked(restoreHealthSet).mockResolvedValue(ok(PLANNED));
    render(<Screen detail={session([squat(PLANNED)])} />);

    await userEvent.click(screen.getByRole("button", { name: COPY.addSet }));
    expect(addHealthSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION,
        sessionExerciseId: id(200),
        weightGrams: 82_500,
        reps: 6,
        warmup: false,
      }),
    );
    expect(screen.getByRole("textbox", { name: COPY.weightName(serie(2)) })).toHaveValue("82,5");

    await userEvent.click(screen.getByRole("button", { name: COPY.setMenu(0, SQUAT) }));
    await userEvent.click(
      within(rowOf(PLANNED[0].id)).getByRole("button", { name: COPY.removeSet }),
    );
    expect(removeHealthSet).toHaveBeenCalledWith({ sessionId: SESSION, id: PLANNED[0].id });
    expect(rowOf(PLANNED[0].id)).toBeNull();
    // Focus goes to the next set's menu.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.setMenu(0, SQUAT) })).toHaveFocus(),
    );
    const notices = screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
    await userEvent.click(await within(notices).findByRole("button", { name: HEALTH_COPY.undo }));
    await waitFor(() =>
      expect(restoreHealthSet).toHaveBeenCalledWith({
        sessionId: SESSION,
        id: PLANNED[0].id,
        afterId: null,
        position: 0,
      }),
    );
    await waitFor(() => expect(rowOf(PLANNED[0].id)).not.toBeNull());
  });

  test("«Terminar»: the summary, the planned sets go, and «Deshacer» reopens it", async () => {
    const done = set(0, { weightGrams: 80_000, reps: 8, doneAt: new Date().toISOString() });
    const planned = set(1, { weightGrams: 80_000, reps: 8 });
    const detail = session([squat([done, planned])]);
    vi.mocked(finishHealthSession).mockResolvedValue(
      ok({
        id: SESSION,
        endedAt: new Date().toISOString(),
        updatedAt: "2026-11-04T19:00:00.123Z",
        removedSetIds: [planned.id],
      }),
    );
    vi.mocked(undoFinishHealthSession).mockResolvedValue(ok(detail));
    render(<Screen detail={detail} />);

    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    const sheet = await screen.findByRole("dialog", { name: COPY.finishTitle });
    expect(within(sheet).getByText(COPY.finishSummary("20 min", 1))).toBeVisible();
    expect(within(sheet).getByText(COPY.finishPlannedHint(1))).toBeVisible();
    await userEvent.type(within(sheet).getByRole("textbox", { name: COPY.note }), "Bien");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.finishConfirm }));
    expect(finishHealthSession).toHaveBeenCalledWith({
      sessionId: SESSION,
      endedAt: null,
      note: "Bien",
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: COPY.finish })).toBeNull());
    // The «Terminar» key is gone: focus lands on the title.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Rutina A" })).toHaveFocus(),
    );
    expect(rowOf(planned.id)).toBeNull();
    expect(screen.getByRole("button", { name: COPY.deleteSession })).toBeVisible();

    const notices = screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
    expect(await within(notices).findByText(COPY.finishedTitle)).toBeVisible();
    await userEvent.click(within(notices).getByRole("button", { name: HEALTH_COPY.undo }));
    await waitFor(() =>
      expect(undoFinishHealthSession).toHaveBeenCalledWith({
        sessionId: SESSION,
        updatedAt: "2026-11-04T19:00:00.123Z",
      }),
    );
    expect(await screen.findByRole("button", { name: COPY.finish })).toBeVisible();
    expect(rowOf(planned.id)).not.toBeNull();
  });

  test("a marked set still unsaved holds «Terminar» until «Reintentar» saves it", async () => {
    vi.mocked(updateHealthSet).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(updateHealthSet).mockImplementation(async () =>
      ok({ ...PLANNED[0], doneAt: "2026-11-04T18:10:00.000Z" }),
    );
    vi.mocked(finishHealthSession).mockResolvedValue(
      ok({
        id: SESSION,
        endedAt: new Date().toISOString(),
        updatedAt: "2026-11-04T19:00:00.123Z",
        removedSetIds: [PLANNED[1].id],
      }),
    );
    render(<Screen detail={session([squat(PLANNED)])} />);
    await userEvent.click(check(PLANNED[0].id));
    await screen.findByRole("button", { name: COPY.retryName(0, SQUAT) });
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    const sheet = await screen.findByRole("dialog", { name: COPY.finishTitle });
    expect(within(sheet).getByText(SESSION_ERRORS.unsavedSets)).toBeVisible();
    const confirm = within(sheet).getByRole("button", { name: COPY.finishConfirm });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(confirm);
    expect(finishHealthSession).not.toHaveBeenCalled();

    await userEvent.click(within(sheet).getByRole("button", { name: COPY.retryAllName }));
    await waitFor(() => expect(within(sheet).queryByText(SESSION_ERRORS.unsavedSets)).toBeNull());
    expect(confirm).not.toHaveAttribute("aria-disabled");
    await userEvent.click(confirm);
    await waitFor(() => expect(finishHealthSession).toHaveBeenCalledTimes(1));
  });

  test("«Deshacer» of a removed set keeps what another set holds unsaved", async () => {
    vi.mocked(updateHealthSet).mockRejectedValue(new Error("offline"));
    vi.mocked(removeHealthSet).mockResolvedValue(ok({ id: PLANNED[0].id, position: 0 }));
    // The server still has the second set's old weight.
    vi.mocked(restoreHealthSet).mockResolvedValue(ok(PLANNED));
    render(<Screen detail={session([squat(PLANNED)])} />);
    const second = screen.getByRole("textbox", { name: COPY.weightName(serie(1)) });
    await userEvent.clear(second);
    await userEvent.type(second, "90");
    await screen.findByRole("button", { name: COPY.retryName(1, SQUAT) });

    await userEvent.click(screen.getByRole("button", { name: COPY.setMenu(0, SQUAT) }));
    await userEvent.click(
      within(rowOf(PLANNED[0].id)).getByRole("button", { name: COPY.removeSet }),
    );
    const notices = screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
    // One notice at a time: Esc dismisses «Sin guardar», then «Serie quitada · Deshacer» shows.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await within(notices).findByRole("button", { name: HEALTH_COPY.undo }));
    await waitFor(() => expect(restoreHealthSet).toHaveBeenCalled());
    await waitFor(() => expect(rowOf(PLANNED[0].id)).not.toBeNull());
    expect(screen.getByRole("textbox", { name: COPY.weightName(serie(1)) })).toHaveValue("90");
    expect(within(rowOf(PLANNED[1].id)).getByText(COPY.unsaved)).toBeVisible();
  });

  test("a set's menu closes on Esc (focus back on its key) and after «Calentamiento»", async () => {
    vi.mocked(updateHealthSet).mockImplementation(async () => ok({ ...PLANNED[0], warmup: true }));
    render(<Screen detail={session([squat(PLANNED)])} />);
    const key = screen.getByRole("button", { name: COPY.setMenu(0, SQUAT) });
    await userEvent.click(key);
    expect(key).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(key.getAttribute("aria-controls")!)).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(key).toHaveAttribute("aria-expanded", "false");
    expect(key).toHaveFocus();
    await userEvent.click(key);
    await userEvent.click(within(rowOf(PLANNED[0].id)).getByRole("button", { name: COPY.warmup }));
    expect(key).toHaveAttribute("aria-expanded", "false");
    expect(updateHealthSet).toHaveBeenCalledWith(expect.objectContaining({ warmup: true }));
  });

  test("without a done set the sheet offers «Descartar la sesión»", async () => {
    vi.mocked(deleteHealthSession).mockResolvedValue(ok({ id: SESSION, routineName: "Rutina A" }));
    render(<Screen detail={session([squat(PLANNED)])} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    const sheet = await screen.findByRole("dialog", { name: COPY.finishTitle });
    expect(within(sheet).queryByRole("button", { name: COPY.finishConfirm })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.discard }));
    expect(deleteHealthSession).toHaveBeenCalledWith({ sessionId: SESSION });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/health/sessions?deleted=${SESSION}`),
    );
  });
});

describe("the rest bar", () => {
  function Harness({ announce }: { announce: (message: string) => void }) {
    const timer = useRestTimer("s1", announce);
    return (
      <>
        <button type="button" id="origin" onClick={() => timer.start(30)}>
          go
        </button>
        <RestBar timer={timer} returnFocus={() => document.getElementById("origin")} />
      </>
    );
  }

  const left = () => screen.getByRole("timer").textContent;

  test("±15 s, and at zero it vibrates, says so once and goes", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const announce = vi.fn();
    render(<Harness announce={announce} />);
    fireEvent.click(screen.getByText("go"));
    expect(left()).toBe("0:30");
    fireEvent.click(screen.getByRole("button", { name: COPY.restPlusName }));
    expect(left()).toBe("0:45");
    fireEvent.click(screen.getByRole("button", { name: COPY.restMinusName }));
    expect(left()).toBe("0:30");
    act(() => vi.advanceTimersByTime(10_000));
    expect(Number(left()?.split(":")[1])).toBeLessThanOrEqual(21);
    act(() => vi.advanceTimersByTime(21_000));
    expect(restBar()).toBeNull();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(COPY.restOver);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("health:rest:s1")).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(announce).toHaveBeenCalledTimes(1);
  });

  test("a reload keeps counting from the stored end; the clock stops on unmount", () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(
      "health:rest:s1",
      // On the clock's second, as the bar stores it.
      JSON.stringify({ endAt: Math.floor(Date.now() / 1000) * 1000 + 20_000, total: 90 }),
    );
    const view = render(<Harness announce={() => {}} />);
    expect(left()).toBe("0:20");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a storage that throws: it still runs (it just won't survive a reload)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<Harness announce={() => {}} />);
    expect(restBar()).toBeNull();
    fireEvent.click(screen.getByText("go"));
    expect(left()).toBe("0:30");
  });

  test("«Saltar» with focus on it gives focus back to where the rest started", async () => {
    render(<Harness announce={() => {}} />);
    await userEvent.click(screen.getByText("go"));
    await userEvent.click(screen.getByRole("button", { name: COPY.restSkipName }));
    expect(restBar()).toBeNull();
    expect(screen.getByText("go")).toHaveFocus();
  });
});

describe("the top of /health", () => {
  const ROUTINES = [
    { id: id(50), name: "Rutina A" },
    { id: id(51), name: "Rutina B" },
  ];
  const NEXT = { id: id(51), name: "Rutina B", position: 1, lastDoneAt: null };

  function Start(props: Partial<React.ComponentProps<typeof SessionStart>>) {
    return (
      <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
        <SessionStart open={null} next={NEXT} routines={ROUTINES} {...props} />
      </ScreenServicesProvider>
    );
  }

  test("«Empezar» the routine that comes next opens the new session", async () => {
    vi.mocked(startHealthSession).mockResolvedValue(ok({ started: true, id: id(9) }));
    render(<Start />);
    await userEvent.click(screen.getByRole("button", { name: COPY.start("Rutina B") }));
    expect(startHealthSession).toHaveBeenCalledWith({ routineId: id(51) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/health/sessions/${id(9)}`));
  });

  test("with one already open: «Ya tienes un entreno en curso» and «Seguir»", async () => {
    vi.mocked(startHealthSession).mockResolvedValue(ok({ started: false, openId: id(8) }));
    render(<Start />);
    await userEvent.click(screen.getByRole("button", { name: COPY.startFree }));
    expect(startHealthSession).toHaveBeenCalledWith({ routineId: null });
    const notices = screen.getByRole("region", { name: HEALTH_COPY.noticesLabel });
    expect(await within(notices).findByText(SESSION_ERRORS.alreadyOpen)).toBeVisible();
    await userEvent.click(within(notices).getByRole("button", { name: COPY.resume }));
    expect(router.push).toHaveBeenCalledWith(`/health/sessions/${id(8)}`);
  });

  test("«Otra rutina» lists them; an open session shows «Seguir» instead", async () => {
    vi.mocked(startHealthSession).mockResolvedValue(ok({ started: true, id: id(9) }));
    const view = render(<Start />);
    await userEvent.click(screen.getByRole("button", { name: COPY.otherRoutine }));
    const sheet = await screen.findByRole("dialog", { name: COPY.pickRoutineTitle });
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.start("Rutina A") }));
    await waitFor(() => expect(startHealthSession).toHaveBeenCalledWith({ routineId: id(50) }));
    view.unmount();

    render(<Start open={{ id: id(7), routineName: null, startedAt: new Date().toISOString() }} />);
    expect(screen.getByRole("link", { name: COPY.resumeName(COPY.freeSession) })).toHaveAttribute(
      "href",
      `/health/sessions/${id(7)}`,
    );
    expect(screen.queryByRole("button", { name: COPY.startFree })).toBeNull();
  });
});

describe("the pages", () => {
  const summary = (n: number, values: Partial<SessionSummary> = {}): SessionSummary => ({
    id: id(400 + n),
    routineName: "Rutina A",
    startedAt: "2026-11-03T23:00:00.000Z",
    endedAt: "2026-11-03T23:52:00.000Z",
    doneSets: 14,
    ...values,
  });

  test("/health fills its slots: «Seguir» and «Últimas sesiones» with «Ver todas»", async () => {
    vi.mocked(listRoutines).mockResolvedValue([]);
    vi.mocked(getOpenSession).mockResolvedValue({
      id: id(7),
      routineName: "Rutina A",
      startedAt: new Date().toISOString(),
    });
    vi.mocked(getNextRoutine).mockResolvedValue(null);
    vi.mocked(listSessions).mockResolvedValue({ sessions: [summary(1)], total: 1 });
    render(await HealthPage({ searchParams: Promise.resolve({}) }));
    expect(listSessions).toHaveBeenCalledWith(10);
    expect(screen.getByRole("link", { name: COPY.resumeName("Rutina A") })).toBeVisible();
    const recent = screen.getByRole("list", { name: COPY.recentLabel });
    expect(within(recent).getByRole("link")).toHaveAccessibleDescription("52 min · 14 series");
    expect(screen.getByRole("link", { name: COPY.seeAll })).toHaveAttribute(
      "href",
      "/health/sessions",
    );
  });

  test("/health/sessions: 30 at a time with «Ver más»", async () => {
    vi.mocked(listSessions).mockResolvedValue({
      sessions: [summary(1), summary(2, { endedAt: null, routineName: null })],
      total: 45,
    });
    render(await SessionsPage({ searchParams: Promise.resolve({}) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(listSessions).toHaveBeenCalledWith(30);
    const rows = within(screen.getByRole("list", { name: COPY.listLabel })).getAllByRole("link");
    expect(rows[1]).toHaveAccessibleDescription(COPY.inProgress);
    expect(screen.getByRole("link", { name: COPY.seeMore })).toHaveAttribute(
      "href",
      "/health/sessions?n=60",
    );
    expect(getDeletedSession).not.toHaveBeenCalled();
  });

  test("a session's page reads it and the catalogue; a missing one is a 404", async () => {
    vi.mocked(getSession).mockResolvedValue(session([squat(PLANNED)]));
    vi.mocked(listExercises).mockResolvedValue([]);
    const params = (value: string) => ({ params: Promise.resolve({ id: value }) });
    render(await SessionPage(params(SESSION)));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Rutina A" })).toBeVisible();
    expect((await generateMetadata(params(SESSION))).title).toBe("Rutina A · Entreno · brahua-os");
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(SessionPage(params(id(2)))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(params(id(2)))).title).toBe(COPY.notFoundTitle);
  });
});
