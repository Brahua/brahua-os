// `learning` L2: the timer and the sessions as the owner uses them, against a fake server (actions
// mocked; the screen's queue, notices, sheets and focus are the real ones). «Estudiar» runs at once
// and starting another track stops the running one (with exact «Deshacer»), «Detener» saves, more
// than 4 h asks «¿Cuánto estudiaste?», the clock's interval goes away on unmount, the week against
// the target, «Anotar tiempo» and «Quitar» with «Deshacer». Days are Lima's real today.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { SessionsSection } from "@/modules/learning/components/sessions-section";
import { ElapsedTime } from "@/modules/learning/components/study-key";
import { TrackDetail } from "@/modules/learning/components/track-detail";
import { TracksScreen } from "@/modules/learning/components/tracks-screen";
import { LEARNING_COPY } from "@/modules/learning/learning-copy";
import { addDays, mondayOf } from "@/modules/learning/pace";
import {
  logSession,
  removeSession,
  restoreSession,
  startSession,
  stopSession,
  undoStartSession,
  undoStopSession,
} from "@/modules/learning/sessions-actions";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "@/modules/learning/sessions-copy";
import type {
  RunningSession,
  SessionItem,
  StartResult,
  StoppedSession,
} from "@/modules/learning/sessions-input";
import type { TrackItem } from "@/modules/learning/tracks-input";

vi.mock("@/modules/learning/sessions-actions", () => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
  undoStartSession: vi.fn(),
  undoStopSession: vi.fn(),
  logSession: vi.fn(),
  removeSession: vi.fn(),
  restoreSession: vi.fn(),
}));
vi.mock("@/modules/learning/tracks-actions", () => ({
  createTrack: vi.fn(),
  updateTrack: vi.fn(),
  changeStatus: vi.fn(),
  undoStatus: vi.fn(),
  deleteTrack: vi.fn(),
  restoreTrack: vi.fn(),
}));
vi.mock("@/modules/learning/steps-actions", () => ({
  addStep: vi.fn(),
  pasteSteps: vi.fn(),
  undoPasteSteps: vi.fn(),
  renameStep: vi.fn(),
  markStepDone: vi.fn(),
  undoMarkStepDone: vi.fn(),
  deleteStep: vi.fn(),
  undoDeleteStep: vi.fn(),
  reorderSteps: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const TODAY = ownerDateKey(new Date());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function track(n: number, patch: Partial<TrackItem> = {}): TrackItem {
  return {
    id: id(n),
    title: `Frente ${n}`,
    kind: "course",
    status: "active",
    projectId: null,
    url: null,
    weeklyTargetMinutes: null,
    targetDate: null,
    position: n,
    finishedAt: null,
    steps: { done: 0, total: 0 },
    upcoming: [],
    ...patch,
  };
}

const AWS = track(1, { title: "AWS SAA", kind: "certification", weeklyTargetMinutes: 180 });
const INGLES = track(2, { title: "Inglés", kind: "practice" });
const DOCKER = track(3, {
  title: "Docker",
  status: "done",
  finishedAt: "2026-10-20T15:00:00.000Z",
});

const running = (trackItem: TrackItem, startedAt = ago(42)): RunningSession => ({
  id: id(500 + Number(trackItem.id.slice(-3))),
  trackId: trackItem.id,
  trackTitle: trackItem.title,
  startedAt,
});

function List({
  tracks = [AWS, INGLES, DOCKER],
  run = null,
  minutes = {},
}: {
  tracks?: TrackItem[];
  run?: RunningSession | null;
  minutes?: Record<string, { week: number; total: number }>;
}) {
  return (
    <ScreenServicesProvider label={LEARNING_COPY.noticesLabel} actionHint={LEARNING_COPY.undoHint}>
      <TracksScreen
        tracks={tracks}
        projects={[]}
        today={TODAY}
        headingId="learning-title"
        minutes={minutes}
        running={run}
      />
    </ScreenServicesProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const studyKey = (title: string) => screen.getByRole("button", { name: COPY.studyName(title) });
const stopKey = (title: string) => screen.getByRole("button", { name: COPY.stopName(title) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the timer on the list", () => {
  test("«Estudiar» runs at once with its clock, keeps focus, and «Deshacer» removes that session", async () => {
    const answer = deferred<ReturnType<typeof ok<StartResult>>>();
    vi.mocked(startSession).mockReturnValue(answer.promise);
    vi.mocked(undoStartSession).mockResolvedValue(ok({ restored: true as const }));
    render(<List />);
    const key = studyKey("AWS SAA");
    await userEvent.click(key);
    expect(startSession).toHaveBeenCalledWith({ trackId: AWS.id });
    // Optimistic: the same key now says «Detener», still focused, with the clock beside it.
    expect(key).toHaveAccessibleName(COPY.stopName("AWS SAA"));
    expect(key).toHaveFocus();
    expect(key).toHaveAttribute("aria-disabled", "true");
    const card = key.closest("[data-track-card]") as HTMLElement;
    expect(within(card).getByText(/^0:0\d$/)).toBeInTheDocument();
    expect(within(card).getByText(COPY.runningName(0))).toBeInTheDocument();
    const session = running(AWS, new Date().toISOString());
    await act(async () => answer.resolve(ok({ session, stopped: null })));
    expect(await screen.findByText(COPY.started("AWS SAA"))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: LEARNING_COPY.undo }));
    expect(undoStartSession).toHaveBeenCalledWith({ id: session.id, stopped: null });
    expect(await screen.findByText(LEARNING_COPY.statusRestored)).toBeVisible();
  });

  test("starting another track stops the running one; its «Deshacer» carries the stopped snapshot", async () => {
    const stopped: StoppedSession = {
      id: id(501),
      trackId: AWS.id,
      trackTitle: "AWS SAA",
      minutes: 42,
      endedAt: "2026-11-02T15:00:00.000Z",
    };
    const session = running(INGLES);
    vi.mocked(startSession).mockResolvedValue(ok({ session, stopped }));
    vi.mocked(undoStartSession).mockResolvedValue(ok({ restored: true as const }));
    render(<List run={running(AWS)} />);
    expect(stopKey("AWS SAA")).toBeVisible();
    await userEvent.click(studyKey("Inglés"));
    expect(startSession).toHaveBeenCalledWith({ trackId: INGLES.id });
    expect(await screen.findByText(COPY.switched("AWS SAA", 42, "Inglés"))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: LEARNING_COPY.undo }));
    expect(undoStartSession).toHaveBeenCalledWith({
      id: session.id,
      stopped: { id: stopped.id, endedAt: stopped.endedAt, minutes: 42 },
    });
  });

  test("«Detener» saves and says how much; «Deshacer» runs it again", async () => {
    const run = running(AWS);
    const stopped: StoppedSession = {
      id: run.id,
      trackId: AWS.id,
      trackTitle: "AWS SAA",
      minutes: 42,
      endedAt: "2026-11-02T15:00:00.000Z",
    };
    vi.mocked(stopSession).mockResolvedValue(ok(stopped));
    vi.mocked(undoStopSession).mockResolvedValue(ok({ restored: true as const }));
    render(<List run={run} />);
    await userEvent.click(stopKey("AWS SAA"));
    expect(stopSession).toHaveBeenCalledWith({ id: run.id });
    expect(await screen.findByText(COPY.stopped(42, "AWS SAA"))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: LEARNING_COPY.undo }));
    expect(undoStopSession).toHaveBeenCalledWith({
      id: run.id,
      endedAt: stopped.endedAt,
      minutes: 42,
    });
  });

  test("a refused start rolls back with the reason", async () => {
    vi.mocked(startSession).mockResolvedValue(fail(SESSION_ERRORS.trackDone));
    render(<List />);
    await userEvent.click(studyKey("AWS SAA"));
    expect(
      await screen.findByText(`${COPY.notSaved.start} ${SESSION_ERRORS.trackDone}`),
    ).toBeVisible();
    await waitFor(() => expect(studyKey("AWS SAA")).toBeVisible());
  });

  test("more than 4 h: «¿Cuánto estudiaste?» before saving; cancelling keeps it running", async () => {
    const run = running(AWS, ago(5 * 60 + 12));
    vi.mocked(stopSession).mockResolvedValue(
      ok({ id: run.id, trackId: AWS.id, trackTitle: "AWS SAA", minutes: 120, endedAt: ago(0) }),
    );
    render(<List run={run} />);
    const key = stopKey("AWS SAA");
    await userEvent.click(key);
    expect(stopSession).not.toHaveBeenCalled();
    const sheet = await screen.findByRole("dialog", { name: COPY.confirmTitle });
    expect(within(sheet).getByText(COPY.confirmText("AWS SAA", 313))).toBeVisible();
    const field = within(sheet).getByLabelText(COPY.minutesLabel);
    expect(field).toHaveValue("313");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(stopSession).not.toHaveBeenCalled();
    await waitFor(() => expect(key).toHaveFocus());

    await userEvent.click(key);
    const again = await screen.findByRole("dialog", { name: COPY.confirmTitle });
    const minutes = within(again).getByLabelText(COPY.minutesLabel);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "0");
    await userEvent.click(within(again).getByRole("button", { name: COPY.confirmSave }));
    expect(await within(again).findByText(SESSION_ERRORS.minutes)).toBeVisible();
    expect(stopSession).not.toHaveBeenCalled();
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "120");
    await userEvent.click(within(again).getByRole("button", { name: COPY.confirmSave }));
    expect(stopSession).toHaveBeenCalledWith({ id: run.id, minutes: 120 });
    expect(await screen.findByText(COPY.stopped(120, "AWS SAA"))).toBeVisible();
  });

  test("the server's clock asks first too: its refusal opens the sheet", async () => {
    const run = running(AWS, ago(239));
    vi.mocked(stopSession).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { minutes: [SESSION_ERRORS.confirmNeeded] },
    });
    render(<List run={run} />);
    await userEvent.click(stopKey("AWS SAA"));
    expect(await screen.findByRole("dialog", { name: COPY.confirmTitle })).toBeVisible();
  });

  test("the week against the target on the card, and the total on a folded row", async () => {
    render(
      <List
        minutes={{ [AWS.id]: { week: 80, total: 500 }, [DOCKER.id]: { week: 0, total: 750 } }}
      />,
    );
    const card = studyKey("AWS SAA").closest("[data-track-card]") as HTMLElement;
    expect(within(card).getByText("1 h 20 de 3 h esta semana · Te faltan 1 h 40")).toBeVisible();
    // A practice without target and without time says nothing about the week.
    const ingles = studyKey("Inglés").closest("[data-track-card]") as HTMLElement;
    expect(ingles.querySelector("[data-track-week]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Terminados, 1 frente" }));
    expect(screen.getByText(COPY.total(750))).toBeVisible();
  });

  test("a timer on a track that isn't in progress shows above the list and can be stopped", async () => {
    const waiting = track(4, { title: "Clean Code", status: "waiting" });
    render(<List tracks={[AWS, waiting]} run={running(waiting)} />);
    const banner = screen.getByRole("region", { name: COPY.runningBanner });
    expect(within(banner).getByRole("link", { name: "Clean Code" })).toBeVisible();
    expect(within(banner).getByRole("button", { name: COPY.stopName("Clean Code") })).toBeVisible();
  });
});

describe("the clock", () => {
  test("one interval while shown, cleared on unmount", () => {
    const set = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(
      <>
        <ElapsedTime startedAt={ago(65)} />
        <ElapsedTime startedAt={ago(3)} />
      </>,
    );
    expect(screen.getByText(/^1:0[45]:\d\d$/)).toBeInTheDocument();
    expect(screen.getByText(/^[23]:\d\d$/)).toBeInTheDocument();
    expect(set).toHaveBeenCalledTimes(1);
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
    set.mockRestore();
    clear.mockRestore();
  });
});

describe("a track's page", () => {
  const session = (
    n: number,
    startedAt: string,
    minutes: number,
    source = "timer",
  ): SessionItem => ({
    id: id(600 + n),
    source: source as SessionItem["source"],
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
    minutes,
  });
  // Noon of Lima days (17:00 UTC): this week's Monday-safe values come from the real today.
  const noon = (day: string) => `${day}T17:00:00.000Z`;
  const LAST_WEEK = addDays(TODAY, -7);
  const SESSIONS = [
    session(1, noon(TODAY), 42),
    session(2, noon(TODAY), 30, "manual"),
    session(3, noon(LAST_WEEK), 60),
  ];

  function Detail({ sessions = SESSIONS, run = null as RunningSession | null, week = 72 }) {
    return (
      <ScreenServicesProvider
        label={LEARNING_COPY.noticesLabel}
        actionHint={LEARNING_COPY.undoHint}
      >
        <TrackDetail
          track={AWS}
          steps={[]}
          projects={[]}
          projectName={null}
          active={[]}
          today={TODAY}
          headingId="track-title"
          running={run}
          weekMinutes={week}
          sessions={
            <SessionsSection
              track={{ id: AWS.id, title: AWS.title }}
              sessions={sessions}
              today={TODAY}
            />
          }
        />
      </ScreenServicesProvider>
    );
  }

  test("the week and the timer in the header; another track's timer is named", () => {
    render(<Detail run={running(INGLES)} />);
    expect(screen.getByText("1 h 12 de 3 h esta semana · Te faltan 1 h 48")).toBeVisible();
    expect(studyKey("AWS SAA")).toBeVisible();
    expect(screen.getByText(COPY.runningElsewhere("Inglés"))).toBeVisible();
  });

  test("sessions grouped by week with their totals", () => {
    render(<Detail />);
    const section = screen.getByRole("region", { name: COPY.title });
    expect(
      within(section).getByRole("heading", { name: `${COPY.thisWeek}: 1 h 12` }),
    ).toBeVisible();
    expect(
      within(section).getByRole("heading", {
        name: `${COPY.weekOf(mondayOf(LAST_WEEK), TODAY)}: 1 h`,
      }),
    ).toBeVisible();
    expect(within(section).getByText(COPY.manual)).toBeVisible();
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
  });

  test("no sessions yet: a kind line", () => {
    render(<Detail sessions={[]} />);
    expect(screen.getByText(COPY.empty)).toBeVisible();
  });

  test("«Quitar» at once, focus to the next one, and «Deshacer» brings it back", async () => {
    const answer = deferred<ReturnType<typeof ok<SessionItem>>>();
    vi.mocked(removeSession).mockReturnValue(answer.promise);
    vi.mocked(restoreSession).mockResolvedValue(ok(SESSIONS[0]));
    render(<Detail />);
    const first = document.querySelector<HTMLElement>(`[data-session-remove="${SESSIONS[0].id}"]`)!;
    await userEvent.click(first);
    expect(removeSession).toHaveBeenCalledWith({ trackId: AWS.id, id: SESSIONS[0].id });
    // At once (the server's list follows the revalidation; here the answer is still on its way).
    await waitFor(() =>
      expect(document.querySelector(`[data-session-row="${SESSIONS[0].id}"]`)).toBeNull(),
    );
    await waitFor(() =>
      expect(document.querySelector(`[data-session-remove="${SESSIONS[1].id}"]`)).toHaveFocus(),
    );
    await act(async () => answer.resolve(ok(SESSIONS[0])));
    expect(await screen.findByText(COPY.removed(42))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: LEARNING_COPY.undo }));
    expect(restoreSession).toHaveBeenCalledWith({ trackId: AWS.id, id: SESSIONS[0].id });
  });

  test("«Anotar tiempo»: minutes and «Ayer»; its «Deshacer» removes exactly that session", async () => {
    const created = session(9, noon(addDays(TODAY, -1)), 30, "manual");
    vi.mocked(logSession).mockResolvedValue(ok(created));
    vi.mocked(removeSession).mockResolvedValue(ok(created));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.log }));
    const sheet = await screen.findByRole("dialog", { name: COPY.logTitle });
    const minutes = within(sheet).getByLabelText(COPY.minutesLabel);
    await userEvent.type(minutes, "abc");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.save }));
    expect(await within(sheet).findByText(SESSION_ERRORS.minutes)).toBeVisible();
    expect(logSession).not.toHaveBeenCalled();
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "30");
    await userEvent.selectOptions(within(sheet).getByLabelText(COPY.dayLabel), "Ayer");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.save }));
    expect(logSession).toHaveBeenCalledWith({
      trackId: AWS.id,
      minutes: 30,
      day: addDays(TODAY, -1),
    });
    expect(await screen.findByText(COPY.logged(30, "AWS SAA", "Ayer"))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: LEARNING_COPY.undo }));
    expect(removeSession).toHaveBeenCalledWith({ trackId: AWS.id, id: created.id });
  });

  test("a day the server refuses stays in the sheet, on its field", async () => {
    vi.mocked(logSession).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { day: [SESSION_ERRORS.day] },
    });
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.log }));
    const sheet = await screen.findByRole("dialog", { name: COPY.logTitle });
    await userEvent.type(within(sheet).getByLabelText(COPY.minutesLabel), "30");
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.save }));
    expect(await within(sheet).findByText(SESSION_ERRORS.day)).toBeVisible();
  });
});
