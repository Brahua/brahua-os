// `learning` L1: /learning as a page (queries mocked: what it reads and the authorization) and its
// screen as the owner uses it against a fake server (actions mocked; the screen's queue, notices
// and focus handling are the real ones): the sections, the card's «Hecho» with «Deshacer», and
// «Nuevo frente» with the pasted syllabus and the limit of 2.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LearningPage, { metadata } from "@/app/(app)/learning/page";
import { fail, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { TracksScreen } from "@/modules/learning/components/tracks-screen";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import {
  getDeletedTrack,
  getRunningSession,
  getTrackMinutes,
  listProjectChoices,
  listTracks,
} from "@/modules/learning/queries";
import { markStepDone, undoMarkStepDone } from "@/modules/learning/steps-actions";
import { STEPS_COPY } from "@/modules/learning/steps-copy";
import { createTrack, restoreTrack } from "@/modules/learning/tracks-actions";
import type { TrackItem } from "@/modules/learning/tracks-input";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/learning/queries", () => ({
  listTracks: vi.fn(),
  listProjectChoices: vi.fn(),
  getDeletedTrack: vi.fn(),
  getRunningSession: vi.fn(),
  getTrackMinutes: vi.fn(),
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
  markStepDone: vi.fn(),
  undoMarkStepDone: vi.fn(),
}));
vi.mock("@/modules/learning/sessions-actions", () => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
  undoStartSession: vi.fn(),
  undoStopSession: vi.fn(),
  logSession: vi.fn(),
  removeSession: vi.fn(),
  restoreSession: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

/** Lima's day for this run. */
const TODAY = ownerDateKey(new Date());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

const AWS = track(1, {
  title: "AWS SAA",
  kind: "certification",
  steps: { done: 12, total: 40 },
  upcoming: [
    { id: id(101), title: "Clase 13: IAM policies" },
    { id: id(102), title: "Clase 14: S3" },
  ],
  weeklyTargetMinutes: 180,
});
const INGLES = track(2, { title: "Inglés", kind: "practice" });
const LIBRO = track(3, { title: "Clean Code", kind: "book", status: "waiting" });
const DONE = track(4, {
  title: "Docker",
  status: "done",
  finishedAt: "2026-10-20T15:00:00.000Z",
  steps: { done: 10, total: 10 },
});

function Screen({ tracks = [AWS, LIBRO, DONE] }: { tracks?: TrackItem[] }) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <TracksScreen
        tracks={tracks}
        projects={[{ id: id(900), name: "Ruta AWS + IA" }]}
        today={TODAY}
        headingId="learning-title"
      />
    </ScreenServicesProvider>
  );
}

const card = (t: TrackItem) => document.querySelector<HTMLElement>(`[data-track-card="${t.id}"]`)!;

beforeEach(() => {
  for (const action of [createTrack, restoreTrack, markStepDone, undoMarkStepDone]) {
    vi.mocked(action).mockReset();
  }
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(listTracks).mockReset().mockResolvedValue([]);
  vi.mocked(listProjectChoices).mockReset().mockResolvedValue([]);
  vi.mocked(getDeletedTrack).mockReset().mockResolvedValue(null);
  vi.mocked(getRunningSession).mockReset().mockResolvedValue(null);
  vi.mocked(getTrackMinutes).mockReset().mockResolvedValue({});
});

describe("the page", () => {
  const search = (params: Record<string, string> = {}) =>
    ({ searchParams: Promise.resolve(params) }) as never;

  test("checks the owner first, reads the tracks and the projects, and titles itself", async () => {
    render(await LearningPage(search()));
    expect(requireOwner).toHaveBeenCalled();
    expect(listTracks).toHaveBeenCalledTimes(1);
    expect(listProjectChoices).toHaveBeenCalledTimes(1);
    expect(getDeletedTrack).not.toHaveBeenCalled();
    expect(getRunningSession).toHaveBeenCalledTimes(1);
    expect(getTrackMinutes).toHaveBeenCalledTimes(1);
    expect(metadata.title).toBe("Aprendizaje · brahua-os");
    expect(screen.getByRole("heading", { level: 1, name: "Aprendizaje" })).toBeVisible();
  });

  test("no tracks: «¿Qué quieres aprender?» with «Crear mi primer frente»", async () => {
    render(await LearningPage(search()));
    expect(screen.getByRole("heading", { name: COPY.emptyTitle })).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.emptyAction })).toBeVisible();
    expect(screen.queryByRole("button", { name: COPY.newTrack })).toBeNull();
  });

  test("?deleted=<id> reads that track for the «Deshacer» notice", async () => {
    vi.mocked(getDeletedTrack).mockResolvedValue({ id: AWS.id, title: "AWS SAA" });
    vi.mocked(restoreTrack).mockResolvedValue(ok({ track: AWS, movedToWaiting: true }));
    render(await LearningPage(search({ deleted: AWS.id })));
    expect(getDeletedTrack).toHaveBeenCalledWith(AWS.id);
    expect(await screen.findByText("«AWS SAA» se eliminó.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(restoreTrack).toHaveBeenCalledWith({ id: AWS.id });
    expect(await screen.findByText(COPY.restoredWaiting("AWS SAA"))).toBeVisible();
  });

  test("a refused owner never reads anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(LearningPage(search())).rejects.toThrow("NEXT_REDIRECT");
    expect(listTracks).not.toHaveBeenCalled();
    expect(getRunningSession).not.toHaveBeenCalled();
    expect(getTrackMinutes).not.toHaveBeenCalled();
  });
});

describe("the sections", () => {
  test("«En curso» shows the cards; «En espera» and «Terminados» are folded rows", async () => {
    render(<Screen />);
    expect(screen.getByRole("heading", { name: "En curso, 1 de 2" })).toBeVisible();
    const aws = within(card(AWS));
    expect(aws.getByRole("link", { name: "AWS SAA" })).toHaveAttribute(
      "href",
      `/learning/${AWS.id}`,
    );
    expect(aws.getByText("Certificación")).toBeVisible();
    expect(aws.getByText("Clase 13: IAM policies")).toBeVisible();
    expect(aws.getByText("12 de 40")).toBeVisible();
    expect(aws.getByRole("meter", { name: "Temario de AWS SAA: 12 de 40 pasos" })).toBeVisible();
    // L2: the week against the target (no session yet: what is left, never a debt).
    expect(aws.getByText("0 min de 3 h esta semana · Te faltan 3 h")).toBeVisible();

    const waiting = screen.getByRole("button", { name: "En espera, 1 frente" });
    expect(waiting).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Clean Code" })).toBeNull();
    await userEvent.click(waiting);
    expect(screen.getByRole("link", { name: "Clean Code" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Terminados, 1 frente" }));
    expect(screen.getByText(COPY.finishedOn("2026-10-20"))).toBeVisible();
  });

  test("a practice says it has no syllabus; a track without one asks for it; no «Hecho»", () => {
    render(<Screen tracks={[INGLES, track(5, { title: "Sin temario" })]} />);
    expect(within(card(INGLES)).getByText(COPY.practiceNote)).toBeVisible();
    expect(within(card(track(5))).getByText(COPY.noSyllabus)).toBeVisible();
    expect(screen.queryByRole("button", { name: /como hecho/ })).toBeNull();
  });

  test("with a target date, the pace (never «atrasado»)", () => {
    render(
      <Screen
        tracks={[
          track(6, {
            targetDate: "2000-01-01",
            steps: { done: 1, total: 4 },
            upcoming: [{ id: id(1), title: "x" }],
          }),
        ]}
      />,
    );
    expect(screen.getByText("La fecha pasó: ponle otra o quítala")).toBeVisible();
  });

  test("nothing in progress: it says so, without guilt", () => {
    render(<Screen tracks={[LIBRO]} />);
    expect(screen.getByText(COPY.activeEmpty)).toBeVisible();
  });
});

describe("«Hecho» on a card", () => {
  test("checks the next step at once (the one after it shows) and «Deshacer» sends exactly what it changed", async () => {
    let answer: (value: Awaited<ReturnType<typeof markStepDone>>) => void = () => {};
    vi.mocked(markStepDone).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.mocked(undoMarkStepDone).mockResolvedValue(
      ok({ id: id(101), title: "Clase 13: IAM policies", position: 12, doneAt: null }),
    );
    render(<Screen />);
    await userEvent.click(
      within(card(AWS)).getByRole("button", { name: "Marcar «Clase 13: IAM policies» como hecho" }),
    );
    expect(markStepDone).toHaveBeenCalledWith({ trackId: AWS.id, id: id(101), done: true });
    // While it saves: the next one and the bar already moved, and focus stays on «Hecho».
    expect(within(card(AWS)).getByText("Clase 14: S3")).toBeVisible();
    expect(within(card(AWS)).getByText("13 de 40")).toBeVisible();
    expect(within(card(AWS)).getByRole("button", { name: /Clase 14: S3/ })).toHaveFocus();
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
    );
    expect(await screen.findByText("«Clase 13: IAM policies» está hecho.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(undoMarkStepDone).toHaveBeenCalledWith({
      trackId: AWS.id,
      id: id(101),
      expected: "2026-11-02T15:00:00.123Z",
      restore: null,
    });
  });

  test("a refusal rolls it back and says why", async () => {
    vi.mocked(markStepDone).mockResolvedValue(fail("Este paso ya no existe."));
    render(<Screen />);
    await userEvent.click(within(card(AWS)).getByRole("button", { name: /como hecho/ }));
    expect(
      await screen.findByText(/No se guardó el paso\. Este paso ya no existe\./),
    ).toBeVisible();
    await waitFor(() => expect(within(card(AWS)).getByText("12 de 40")).toBeVisible());
    expect(within(card(AWS)).getByText("Clase 13: IAM policies")).toBeVisible();
  });
});

describe("«Nuevo frente»", () => {
  async function openSheet(tracks?: TrackItem[]) {
    render(<Screen tracks={tracks} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newTrack }));
    return screen.findByRole("dialog", { name: COPY.newSheetTitle });
  }

  test("an empty name is refused on its field and nothing is sent", async () => {
    const dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(await within(dialog).findByText("Ponle un nombre.")).toBeVisible();
    await waitFor(() => expect(within(dialog).getByLabelText(COPY.titleLabel)).toHaveFocus());
    expect(createTrack).not.toHaveBeenCalled();
  });

  test("pasting the syllabus counts its steps; it is sent with the fields and starts in progress", async () => {
    vi.mocked(createTrack).mockResolvedValue(
      ok({ track: track(9, { title: "AWS" }), changes: [] }),
    );
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "AWS");
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.kindLabel), "certification");
    const syllabus = within(dialog).getByLabelText(COPY.syllabusLabel);
    await userEvent.type(syllabus, "Clase 1{enter}{enter}Clase 2{enter}Clase 3");
    expect(within(dialog).getByText(/^3 pasos\./)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.rhythm }));
    await userEvent.type(within(dialog).getByLabelText(COPY.hoursLabel), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.more }));
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.projectLabel), id(900));
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createTrack).toHaveBeenCalledWith({
      title: "AWS",
      kind: "certification",
      projectId: id(900),
      url: "",
      weeklyTargetMinutes: 180,
      targetDate: "",
      syllabus: "Clase 1\n\nClase 2\nClase 3",
      status: "active",
      pauseTrackId: "",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("«AWS» está en curso.")).toBeVisible();
  });

  test("a practice hides the syllabus and sends none", async () => {
    vi.mocked(createTrack).mockResolvedValue(ok({ track: INGLES, changes: [] }));
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "Inglés");
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.kindLabel), "practice");
    expect(within(dialog).queryByLabelText(COPY.syllabusLabel)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "practice", syllabus: "" }),
    );
  });

  test("with 2 in progress it starts waiting; «En curso» asks which one moves to «En espera»", async () => {
    const second = track(7, { title: "Platzi IA" });
    vi.mocked(createTrack).mockResolvedValue(
      ok({
        track: track(9, { title: "Nuevo" }),
        changes: [
          {
            id: second.id,
            title: "Platzi IA",
            from: { status: "active", position: 1, finishedAt: null },
            to: "waiting",
          },
        ],
      }),
    );
    const dialog = await openSheet([AWS, second]);
    const status = within(dialog).getByRole("radiogroup", { name: COPY.statusLabel });
    expect(within(status).getByRole("radio", { name: "En espera" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(dialog).queryByLabelText(COPY.pauseChoiceLabel)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "Nuevo");
    await userEvent.click(within(status).getByRole("radio", { name: "En curso" }));
    expect(within(dialog).getByText(COPY.fullNote)).toBeVisible();
    // Without choosing one: the limit's message, nothing sent.
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(await within(dialog).findByText(/Ya tienes 2 en curso\. Pasa uno/)).toBeVisible();
    expect(createTrack).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.pauseChoiceLabel), second.id);
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createTrack).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", pauseTrackId: second.id }),
    );
    expect(await screen.findByText(COPY.swapped("Platzi IA", "Nuevo"))).toBeVisible();
  });

  test("a refusal from the server keeps the sheet open with the error on its field", async () => {
    vi.mocked(createTrack).mockResolvedValue({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { projectId: ["Ese proyecto ya no está disponible. Elige otro o ninguno."] },
    });
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(COPY.titleLabel), "AWS");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(await within(dialog).findByText(/Ese proyecto ya no está disponible/)).toBeVisible();
    // Its fold opened to show it.
    expect(within(dialog).getByRole("button", { name: COPY.more })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("copy sanity", () => {
  test("the card's «Hecho» names its step", () => {
    expect(STEPS_COPY.doneName("Clase 1")).toBe("Marcar «Clase 1» como hecho");
  });
});
