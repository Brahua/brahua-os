// `health` E3: the records on screen. The line's geometry and its accessible table, the exercise's
// records slot (empty, records with their session, history with «Ver más»), the session rows'
// «· 2 récords», and the session screen: the summary lists the new records, `celebrate()` fires
// once right after a «Terminar» that set some (never on opening a finished session, never without
// records), and a correction of a finished session reads the records again. The pages read through
// the queries (mocked).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ExercisePage from "@/app/(app)/health/exercises/[id]/page";
import { ok } from "@/lib/action-result";
import { celebrate } from "@/lib/celebrate";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ExerciseRecords } from "@/modules/health/components/exercise-records";
import { lineGeometry, ProgressLine } from "@/modules/health/components/progress-line";
import { SessionRows } from "@/modules/health/components/session-rows";
import { SessionScreen } from "@/modules/health/components/session-screen";
import type { ExerciseItem } from "@/modules/health/exercises-input";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getExercise, getExerciseRecords } from "@/modules/health/queries";
import type { ExerciseRecordsView, SessionRecord } from "@/modules/health/records";
import { RECORDS_COPY } from "@/modules/health/records-copy";
import {
  finishHealthSession,
  readHealthSessionRecords,
  updateHealthSet,
} from "@/modules/health/sessions-actions";
import { SESSIONS_COPY as COPY } from "@/modules/health/sessions-copy";
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
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(async () => {}) }));
vi.mock("@/modules/health/queries", () => ({
  getExercise: vi.fn(),
  getExerciseRecords: vi.fn(),
}));
vi.mock("@/modules/health/sessions-actions", () => ({
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
  readHealthSessionRecords: vi.fn(),
}));
vi.mock("@/modules/health/exercises-actions", () => ({
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(1);
const SQUAT = "Sentadilla con barra";

const RECORDS: SessionRecord[] = [
  { exerciseId: id(100), exerciseName: SQUAT, metric: "maxWeight", value: 82_500 },
  { exerciseId: id(101), exerciseName: "Press de banca", metric: "e1rm", value: 79_000 },
];

const set = (n: number, values: Partial<SessionSet> = {}): SessionSet => ({
  id: id(300 + n),
  position: n,
  weightGrams: 80_000,
  reps: 8,
  seconds: null,
  distanceMeters: null,
  warmup: false,
  doneAt: null,
  ...values,
});

const squat = (sets: SessionSet[]): SessionExercise => ({
  id: id(200),
  exerciseId: id(100),
  name: SQUAT,
  kind: "weight_reps",
  equipment: "barbell",
  perDumbbell: false,
  restSeconds: 120,
  exerciseRestSeconds: 90,
  position: 0,
  sets,
  previous: [],
});

const session = (sets: SessionSet[], values: Partial<SessionDetail> = {}): SessionDetail => ({
  id: SESSION,
  routineId: id(50),
  routineName: "Rutina A",
  startedAt: new Date(Date.now() - 52 * 60_000).toISOString(),
  endedAt: null,
  note: null,
  updatedAt: "2026-11-04T18:00:00.000Z",
  exercises: [squat(sets)],
  ...values,
});

function Screen({ detail, records }: { detail: SessionDetail; records?: SessionRecord[] }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <SessionScreen session={detail} catalogue={[]} records={records} headingId="session-title" />
    </ScreenServicesProvider>
  );
}

const summaryBox = () => document.querySelector<HTMLElement>("[data-session-summary]")!;
const recordList = () => screen.queryByRole("list", { name: RECORDS_COPY.newListLabel });

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

describe("the line", () => {
  test("geometry: evenly spaced, the highest on top, one or equal values in the middle", () => {
    expect(lineGeometry([])).toEqual({ points: [], path: "" });
    expect(lineGeometry([5], 100, 50, 10).points).toEqual([{ x: 50, y: 25 }]);
    expect(lineGeometry([3, 3], 100, 50, 10).points).toEqual([
      { x: 10, y: 25 },
      { x: 90, y: 25 },
    ]);
    const { points, path } = lineGeometry([80, 90, 85], 100, 50, 10);
    expect(points).toEqual([
      { x: 10, y: 40 },
      { x: 50, y: 10 },
      { x: 90, y: 25 },
    ]);
    expect(path).toBe("M10 40 L50 10 L90 25");
  });

  test("the drawing is hidden from assistive tech; the table says the same points", () => {
    render(
      <ProgressLine
        title="Mejor peso por sesión"
        points={[
          { key: "a", day: "lun., 2 nov.", value: 80_000, valueText: "80 kg" },
          { key: "b", day: "mié., 4 nov.", value: 82_500, valueText: "82,5 kg" },
        ]}
      />,
    );
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll("path")).toHaveLength(1);
    const table = screen.getByRole("table", { name: "Mejor peso por sesión, últimos 12 meses" });
    const rows = within(table).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "FechaMejor",
      "lun., 2 nov.80 kg",
      "mié., 4 nov.82,5 kg",
    ]);
  });
});

const VIEW: ExerciseRecordsView = {
  records: [
    {
      metric: "maxWeight",
      score: 82_500,
      value: 82_500,
      sessionId: id(11),
      startedAt: "2026-11-03T23:00:00.000Z",
    },
    {
      metric: "e1rm",
      score: 80_000 * 38,
      value: 101_500,
      sessionId: id(12),
      startedAt: "2026-11-01T23:00:00.000Z",
    },
  ],
  lineMetric: "maxWeight",
  line: [
    { sessionId: id(12), startedAt: "2026-11-01T23:00:00.000Z", value: 80_000 },
    { sessionId: id(11), startedAt: "2026-11-03T23:00:00.000Z", value: 82_500 },
  ],
  history: [
    {
      sessionId: id(11),
      startedAt: "2026-11-03T23:00:00.000Z",
      routineName: "Rutina A",
      sets: "80 kg × 8 · 80 × 8 · 82,5 × 7",
    },
    {
      sessionId: id(12),
      startedAt: "2026-11-01T23:00:00.000Z",
      routineName: null,
      sets: "80 kg × 8",
    },
  ],
  totalSessions: 2,
};

/** The slot inside the screen services (the announcer «Ver más» uses). */
function Slot(props: React.ComponentProps<typeof ExerciseRecords>) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <ExerciseRecords {...props} />
    </ScreenServicesProvider>
  );
}

/** `count` history rows, the newest first. */
const historyOf = (count: number): ExerciseRecordsView["history"] =>
  Array.from({ length: count }, (_, index) => ({
    sessionId: id(1000 + index),
    startedAt: new Date(Date.UTC(2026, 9, 30 - index, 23)).toISOString(),
    routineName: "Rutina A",
    sets: `${80 + index} kg × 5`,
  }));

const announcer = () => document.querySelector("[data-screen-announcer]");

describe("the exercise's records slot", () => {
  test("without sessions: the empty text, no line and no history", () => {
    render(
      <Slot
        exerciseId={id(100)}
        view={{ ...VIEW, records: [], line: [], history: [], totalSessions: 0 }}
        shown={20}
      />,
    );
    expect(screen.getByText(RECORDS_COPY.empty)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list", { name: RECORDS_COPY.historyLabel })).toBeNull();
  });

  test("sessions whose sets give no record: a neutral line instead of the list", () => {
    render(<Slot exerciseId={id(100)} view={{ ...VIEW, records: [] }} shown={20} />);
    expect(screen.getByText(RECORDS_COPY.noRecords)).toBeVisible();
    expect(screen.queryByRole("list", { name: RECORDS_COPY.listLabel })).toBeNull();
    expect(screen.getByRole("list", { name: RECORDS_COPY.historyLabel })).toBeVisible();
  });

  test("records with their value and day (opening the session), the line and the history", () => {
    render(<Slot exerciseId={id(100)} view={VIEW} shown={20} />);
    const records = screen.getByRole("list", { name: RECORDS_COPY.listLabel });
    const items = within(records).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Peso máximo");
    expect(items[0]).toHaveTextContent("82,5 kg");
    expect(items[1]).toHaveTextContent("1RM estimado");
    expect(items[1]).toHaveTextContent("101,5 kg");
    const link = within(items[0]).getByRole("link");
    expect(link).toHaveAttribute("href", `/health/sessions/${id(11)}`);
    expect(link).toHaveAccessibleName(/^Peso máximo, 82,5 kg: abrir la sesión del /);
    expect(screen.getByRole("table")).toBeInTheDocument();
    // The first and last day under the line.
    const days = document.querySelector("[data-progress-days]")!;
    expect(days.children).toHaveLength(2);
    const history = screen.getByRole("list", { name: RECORDS_COPY.historyLabel });
    const rows = within(history).getAllByRole("link");
    expect(rows[0]).toHaveAccessibleDescription("80 kg × 8 · 80 × 8 · 82,5 × 7");
    expect(rows[1]).toHaveAccessibleName(/Sesión libre/);
    // Everything is shown: no «Ver más».
    expect(screen.queryByRole("link", { name: RECORDS_COPY.seeMore })).toBeNull();
  });

  test("one session: no line nor its table, a neutral sentence; records and history stay", () => {
    const one: ExerciseRecordsView = {
      ...VIEW,
      line: VIEW.line.slice(1),
      history: VIEW.history.slice(0, 1),
      totalSessions: 1,
    };
    render(<Slot exerciseId={id(100)} view={one} shown={20} />);
    expect(document.querySelector("[data-progress-line]")).toBeNull();
    expect(document.querySelector("[data-exercise-line] svg")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(RECORDS_COPY.lineOnePoint)).toBeVisible();
    expect(screen.queryByText(RECORDS_COPY.lineEmpty)).toBeNull();
    expect(screen.getByRole("list", { name: RECORDS_COPY.listLabel })).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: RECORDS_COPY.historyLabel })).getAllByRole("link"),
    ).toHaveLength(1);
  });

  test("no session in the last 12 months: the window's sentence, no line", () => {
    render(<Slot exerciseId={id(100)} view={{ ...VIEW, line: [] }} shown={20} />);
    expect(screen.getByText(RECORDS_COPY.lineEmpty)).toBeVisible();
    expect(screen.queryByText(RECORDS_COPY.lineOnePoint)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("«Ver más» replaces the entry; the first new row takes focus and the count is said", async () => {
    const view = { ...VIEW, history: historyOf(20), totalSessions: 45 };
    const { rerender } = render(<Slot exerciseId={id(100)} view={view} shown={20} />);
    const more = screen.getByRole("link", { name: RECORDS_COPY.seeMore });
    expect(more).toHaveAttribute("href", `/health/exercises/${id(100)}?n=40`);
    more.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(more);
    // The server's next page arrives as new props.
    rerender(<Slot exerciseId={id(100)} view={{ ...view, history: historyOf(40) }} shown={40} />);
    const rows = within(screen.getByRole("list", { name: RECORDS_COPY.historyLabel })).getAllByRole(
      "link",
    );
    await waitFor(() => expect(rows[20]).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent(RECORDS_COPY.historyShown(40, 45)));
    expect(screen.getByRole("link", { name: RECORDS_COPY.seeMore })).toHaveAttribute(
      "href",
      `/health/exercises/${id(100)}?n=60`,
    );
  });

  test("the last page: «Ver más» goes, focus lands on the first new row, not on the body", async () => {
    const view = { ...VIEW, history: historyOf(20), totalSessions: 25 };
    const { rerender } = render(<Slot exerciseId={id(100)} view={view} shown={20} />);
    const more = screen.getByRole("link", { name: RECORDS_COPY.seeMore });
    more.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(more);
    rerender(<Slot exerciseId={id(100)} view={{ ...view, history: historyOf(25) }} shown={40} />);
    expect(screen.queryByRole("link", { name: RECORDS_COPY.seeMore })).toBeNull();
    const rows = within(screen.getByRole("list", { name: RECORDS_COPY.historyLabel })).getAllByRole(
      "link",
    );
    await waitFor(() => expect(rows[20]).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent(RECORDS_COPY.historyShown(25, 25)));
  });

  test("new props without a click move nothing and say nothing", async () => {
    const view = { ...VIEW, history: historyOf(20), totalSessions: 45 };
    const { rerender } = render(<Slot exerciseId={id(100)} view={view} shown={20} />);
    rerender(<Slot exerciseId={id(100)} view={{ ...view, history: historyOf(40) }} shown={40} />);
    // Positive control of the cases above: focus stays where it was.
    expect(document.body).toHaveFocus();
    expect(announcer()).toHaveTextContent("");
  });

  test("the page reads the records with its exercise and the page size from `?n=`", async () => {
    const exercise: ExerciseItem = {
      id: id(100),
      name: SQUAT,
      nameKey: "sentadilla con barra",
      kind: "weight_reps",
      muscleGroup: "quads",
      equipment: "barbell",
      perDumbbell: false,
      restSeconds: 90,
    };
    vi.mocked(getExercise).mockResolvedValue(exercise);
    vi.mocked(getExerciseRecords).mockResolvedValue(VIEW);
    render(
      await ExercisePage({
        params: Promise.resolve({ id: id(100) }),
        searchParams: Promise.resolve({ n: "25" }),
      }),
    );
    expect(requireOwner).toHaveBeenCalled();
    expect(getExerciseRecords).toHaveBeenCalledWith(exercise, 40);
    expect(screen.getByRole("heading", { level: 2, name: RECORDS_COPY.title })).toBeVisible();
  });
});

describe("the session rows", () => {
  const summary = (n: number, values: Partial<SessionSummary> = {}): SessionSummary => ({
    id: id(400 + n),
    routineName: "Rutina A",
    startedAt: "2026-11-03T23:00:00.000Z",
    endedAt: "2026-11-03T23:52:00.000Z",
    doneSets: 14,
    newRecords: 0,
    ...values,
  });

  test("«· 2 récords» only when the session set any", () => {
    render(
      <SessionRows
        label="Sesiones"
        sessions={[summary(1, { newRecords: 2 }), summary(2), summary(3, { newRecords: 1 })]}
      />,
    );
    const links = within(screen.getByRole("list", { name: "Sesiones" })).getAllByRole("link");
    expect(links[0]).toHaveAccessibleDescription("52 min · 14 series · 2 récords");
    expect(links[1]).toHaveAccessibleDescription("52 min · 14 series");
    expect(links[2]).toHaveAccessibleDescription("52 min · 14 series · 1 récord");
  });
});

describe("the session screen", () => {
  test("a finished session lists its records; opening it never celebrates", () => {
    // Both ends fixed from one clock read: a start taken after `now` made it 51 min 59 s (flaked).
    const end = Date.now();
    const now = new Date(end).toISOString();
    const startedAt = new Date(end - 52 * 60_000).toISOString();
    render(
      <Screen
        detail={session([set(0, { doneAt: now })], { startedAt, endedAt: now })}
        records={RECORDS}
      />,
    );
    expect(summaryBox()).toHaveTextContent("52 min · 1 serie · 2 récords nuevos");
    const items = within(recordList()!).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Sentadilla con barra: 82,5 kg",
      "Press de banca: 1RM estimado 79 kg",
    ]);
    expect(celebrate).not.toHaveBeenCalled();
  });

  test("«Terminar» with new records: the summary lists them and it celebrates once", async () => {
    const detail = session([set(0, { doneAt: new Date().toISOString() })]);
    vi.mocked(finishHealthSession).mockResolvedValue(
      ok({
        id: SESSION,
        endedAt: new Date().toISOString(),
        updatedAt: "2026-11-04T19:00:00.123Z",
        removedSetIds: [],
        records: RECORDS,
        habitMarked: null,
      }),
    );
    render(<Screen detail={detail} />);
    expect(recordList()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    const sheet = await screen.findByRole("dialog", { name: COPY.finishTitle });
    expect(celebrate).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.finishConfirm }));
    await waitFor(() => expect(recordList()).not.toBeNull());
    expect(summaryBox()).toHaveTextContent("2 récords nuevos");
    expect(within(recordList()!).getAllByRole("listitem")).toHaveLength(2);
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  test("«Terminar» without new records: no list and no celebration", async () => {
    const detail = session([set(0, { doneAt: new Date().toISOString() })]);
    vi.mocked(finishHealthSession).mockResolvedValue(
      ok({
        id: SESSION,
        endedAt: new Date().toISOString(),
        updatedAt: "2026-11-04T19:00:00.123Z",
        removedSetIds: [],
        records: [],
        habitMarked: null,
      }),
    );
    render(<Screen detail={detail} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    const sheet = await screen.findByRole("dialog", { name: COPY.finishTitle });
    await userEvent.click(within(sheet).getByRole("button", { name: COPY.finishConfirm }));
    await waitFor(() => expect(screen.queryByRole("button", { name: COPY.finish })).toBeNull());
    expect(summaryBox()).not.toHaveTextContent("récord");
    expect(recordList()).toBeNull();
    expect(celebrate).not.toHaveBeenCalled();
  });

  test("a correction of a finished session reads the records again", async () => {
    const now = new Date().toISOString();
    const done = set(0, { doneAt: now, weightGrams: 82_500, reps: 5 });
    vi.mocked(updateHealthSet).mockImplementation(async (input) =>
      ok({ ...done, ...(input as Partial<SessionSet>), doneAt: now }),
    );
    vi.mocked(readHealthSessionRecords).mockResolvedValue(ok([RECORDS[0]]));
    render(<Screen detail={session([done], { endedAt: now })} records={RECORDS} />);
    const weight = screen.getByRole("textbox", { name: COPY.weightName(COPY.setName(0, SQUAT)) });
    await userEvent.clear(weight);
    await userEvent.type(weight, "80");
    await userEvent.tab();
    await waitFor(() => expect(updateHealthSet).toHaveBeenCalled());
    await waitFor(() =>
      expect(readHealthSessionRecords).toHaveBeenCalledWith({ sessionId: SESSION }),
    );
    await waitFor(() => expect(within(recordList()!).getAllByRole("listitem")).toHaveLength(1));
    expect(summaryBox()).toHaveTextContent("1 récord nuevo");
    expect(celebrate).not.toHaveBeenCalled();
  });
});
