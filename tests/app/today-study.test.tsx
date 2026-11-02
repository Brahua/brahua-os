// L3 of `learning`: «Estudio» on Hoy (SPEC-learning "Hoy"), against a fake server (actions mocked;
// the board's queue, notices and focus are the real ones). A «Sigue con» card per track in
// progress with its next step and «Hecho» (optimistic, exact «Deshacer», focus kept), the steps,
// the week against the target, «Estudiar» / «Detener» through the same timer as /learning, and
// nothing at all without tracks in progress (the slot still mounts).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { applyStudyCardChange } from "@/modules/learning/components/study-today";
import type { LearningTodayTrack } from "@/modules/learning/contracts";
import { startSession, stopSession } from "@/modules/learning/sessions-actions";
import { SESSIONS_COPY } from "@/modules/learning/sessions-copy";
import type { RunningSession, StartResult } from "@/modules/learning/sessions-input";
import { markStepDone, undoMarkStepDone } from "@/modules/learning/steps-actions";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayStudy } from "@/modules/today/components/today-study";

vi.mock("@/modules/learning/sessions-actions", () => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
  undoStartSession: vi.fn(),
  undoStopSession: vi.fn(),
}));
vi.mock("@/modules/learning/steps-actions", () => ({
  markStepDone: vi.fn(),
  undoMarkStepDone: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// The board refuses nothing on its own day: Lima's real today.
const TODAY = ownerDateKey(new Date());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AWS: LearningTodayTrack = {
  id: id(1),
  title: "AWS SAA",
  kind: "certification",
  steps: { done: 12, total: 40 },
  upcoming: [
    { id: id(101), title: "Clase 13: IAM policies" },
    { id: id(102), title: "Clase 14: S3" },
  ],
  weekMinutes: 80,
  weeklyTargetMinutes: 180,
};
const INGLES: LearningTodayTrack = {
  id: id(2),
  title: "Inglés",
  kind: "practice",
  steps: { done: 0, total: 0 },
  upcoming: [],
  weekMinutes: 0,
  weeklyTargetMinutes: null,
};

function Board({
  tracks = [AWS, INGLES],
  running = null,
}: {
  tracks?: LearningTodayTrack[];
  running?: RunningSession | null;
}) {
  return (
    <TodayBoard
      today={TODAY}
      habits={[]}
      study={{ count: tracks.length, content: <TodayStudy summary={{ tracks, running }} /> }}
    />
  );
}

const section = () => screen.getByRole("region", { name: "Estudio" });
const card = (track: LearningTodayTrack) =>
  section().querySelector(`[data-study-card="${track.id}"]`) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("«Estudio» on Hoy", () => {
  test("one card per track in progress: next step, steps, the week and «Estudiar»", () => {
    render(<Board />);
    expect(screen.getByRole("heading", { level: 2, name: "Estudio" })).toBeVisible();
    expect(within(section()).getByRole("link", { name: "Ver aprendizaje" })).toHaveAttribute(
      "href",
      "/learning",
    );
    const list = within(section()).getByRole("list", { name: "Frentes en curso" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    const aws = within(card(AWS));
    expect(aws.getByText("Certificación")).toBeVisible();
    expect(aws.getByRole("link", { name: "AWS SAA" })).toHaveAttribute(
      "href",
      `/learning/${AWS.id}`,
    );
    expect(aws.getByText("Clase 13: IAM policies")).toBeVisible();
    expect(aws.getByText("12 de 40")).toBeVisible();
    expect(aws.getByText("1 h 20 de 3 h esta semana · Te faltan 1 h 40")).toBeVisible();
    expect(aws.getByRole("button", { name: SESSIONS_COPY.studyName("AWS SAA") })).toBeVisible();

    // A practice: no syllabus, no «Hecho», no week line without time; it can still be studied.
    const ingles = within(card(INGLES));
    expect(ingles.queryByRole("button", { name: /como hecho/ })).toBeNull();
    expect(ingles.queryByText(/esta semana/)).toBeNull();
    expect(ingles.getByRole("button", { name: SESSIONS_COPY.studyName("Inglés") })).toBeVisible();
    // Something in progress: the day is not empty.
    expect(screen.queryByText("Nada programado para hoy")).toBeNull();
  });

  test("no track in progress: no section, and the day can be empty (positive control above)", () => {
    render(<Board tracks={[]} />);
    expect(screen.queryByRole("region", { name: "Estudio" })).toBeNull();
    expect(screen.getByText("Nada programado para hoy")).toBeVisible();
  });

  test("«Hecho» moves the next step and the bar at once, keeps focus, and «Deshacer» is exact", async () => {
    let answer: (value: Awaited<ReturnType<typeof markStepDone>>) => void = () => {};
    vi.mocked(markStepDone).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.mocked(undoMarkStepDone).mockResolvedValue(
      ok({ id: id(101), title: "Clase 13: IAM policies", position: 12, doneAt: null }),
    );
    render(<Board />);
    const key = within(card(AWS)).getByRole("button", {
      name: "Marcar «Clase 13: IAM policies» como hecho",
    });
    await userEvent.click(key);
    expect(markStepDone).toHaveBeenCalledWith({ trackId: AWS.id, id: id(101), done: true });
    expect(within(card(AWS)).getByText("Clase 14: S3")).toBeVisible();
    expect(within(card(AWS)).getByText("13 de 40")).toBeVisible();
    expect(within(card(AWS)).getByRole("button", { name: /Clase 14: S3/ })).toHaveFocus();
    await act(async () =>
      answer(
        ok({
          step: {
            id: id(101),
            title: "Clase 13: IAM policies",
            position: 12,
            doneAt: "2026-11-02T15:00:00.123Z",
          },
          previous: null,
        }),
      ),
    );
    expect(await screen.findByText("«Clase 13: IAM policies» está hecho.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(undoMarkStepDone).toHaveBeenCalledWith({
      trackId: AWS.id,
      id: id(101),
      expected: "2026-11-02T15:00:00.123Z",
      restore: null,
    });
  });

  test("a refused «Hecho» rolls back and says why", async () => {
    vi.mocked(markStepDone).mockResolvedValue(fail("Este paso ya no existe."));
    render(<Board />);
    await userEvent.click(within(card(AWS)).getByRole("button", { name: /como hecho/ }));
    expect(
      await screen.findByText(/No se guardó el paso\. Este paso ya no existe\./),
    ).toBeVisible();
    await waitFor(() => expect(within(card(AWS)).getByText("12 de 40")).toBeVisible());
    expect(within(card(AWS)).getByText("Clase 13: IAM policies")).toBeVisible();
  });

  test("the last step: «Hecho» goes away and focus goes to the card's title", async () => {
    const last: LearningTodayTrack = {
      ...AWS,
      steps: { done: 39, total: 40 },
      upcoming: [{ id: id(140), title: "Clase 40: repaso" }],
    };
    vi.mocked(markStepDone).mockReturnValue(new Promise(() => {}));
    render(<Board tracks={[last]} />);
    await userEvent.click(within(card(last)).getByRole("button", { name: /como hecho/ }));
    expect(within(card(last)).getByText("Completaste el temario.")).toBeVisible();
    await waitFor(() =>
      expect(within(card(last)).getByRole("link", { name: "AWS SAA" })).toHaveFocus(),
    );
  });

  test("«Estudiar» starts the timer at once (one key, focus kept) and «Detener» saves", async () => {
    const session: RunningSession = {
      id: id(500),
      trackId: AWS.id,
      trackTitle: "AWS SAA",
      startedAt: new Date().toISOString(),
    };
    vi.mocked(startSession).mockResolvedValue(ok<StartResult>({ session, stopped: null }));
    render(<Board />);
    const key = within(card(AWS)).getByRole("button", { name: SESSIONS_COPY.studyName("AWS SAA") });
    await userEvent.click(key);
    expect(startSession).toHaveBeenCalledWith({ trackId: AWS.id });
    expect(key).toHaveAccessibleName(SESSIONS_COPY.stopName("AWS SAA"));
    expect(key).toHaveFocus();
    expect(await screen.findByText(SESSIONS_COPY.started("AWS SAA"))).toBeVisible();
  });

  test("a timer already running shows «Detener» on its card; stopping saves it", async () => {
    const run: RunningSession = {
      id: id(501),
      trackId: AWS.id,
      trackTitle: "AWS SAA",
      startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    };
    vi.mocked(stopSession).mockResolvedValue(
      ok({
        id: run.id,
        trackId: AWS.id,
        trackTitle: "AWS SAA",
        minutes: 42,
        endedAt: new Date().toISOString(),
      }),
    );
    render(<Board running={run} />);
    await userEvent.click(
      within(card(AWS)).getByRole("button", { name: SESSIONS_COPY.stopName("AWS SAA") }),
    );
    expect(stopSession).toHaveBeenCalledWith({ id: run.id });
    expect(await screen.findByText(SESSIONS_COPY.stopped(42, "AWS SAA"))).toBeVisible();
    // The other card's key still starts its own timer.
    expect(
      within(card(INGLES)).getByRole("button", { name: SESSIONS_COPY.studyName("Inglés") }),
    ).toBeVisible();
  });
});

describe("applyStudyCardChange", () => {
  test("moves only the track whose next step was checked; a stale change does nothing", () => {
    const [aws, ingles] = applyStudyCardChange([AWS, INGLES], { trackId: AWS.id, stepId: id(101) });
    expect(aws.steps).toEqual({ done: 13, total: 40 });
    expect(aws.upcoming).toEqual([{ id: id(102), title: "Clase 14: S3" }]);
    expect(ingles).toEqual(INGLES);
    expect(applyStudyCardChange([AWS], { trackId: AWS.id, stepId: id(102) })).toEqual([AWS]);
  });
});
