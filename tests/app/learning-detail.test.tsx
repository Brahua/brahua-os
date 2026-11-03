// `learning` L1: a track's page (queries mocked: what it reads, the 404 and the authorization) and
// its screen against a fake server (actions mocked; the queue, notices and focus are the real
// ones): the status actions with «Deshacer», the limit of 2 offering to move one to «En espera»,
// and the syllabus: check with «Deshacer», add, paste, rename, remove and reorder.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TrackPage, { generateMetadata } from "@/app/(app)/learning/[id]/page";
import { ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { celebrate } from "@/lib/celebrate";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { TrackDetail } from "@/modules/learning/components/track-detail";
import { LEARNING_COPY as COPY } from "@/modules/learning/learning-copy";
import {
  getRunningSession,
  getTrack,
  getTrackMinutes,
  listActiveTracks,
  listProjectChoices,
  listSteps,
  listTrackSessions,
} from "@/modules/learning/queries";
import {
  addStep,
  deleteStep,
  markStepDone,
  pasteSteps,
  renameStep,
  reorderSteps,
  undoDeleteStep,
  undoMarkStepDone,
} from "@/modules/learning/steps-actions";
import { STEPS_COPY } from "@/modules/learning/steps-copy";
import type { StepItem } from "@/modules/learning/steps-input";
import { changeStatus, deleteTrack, undoStatus } from "@/modules/learning/tracks-actions";
import type { StatusChange, TrackItem, TrackRef } from "@/modules/learning/tracks-input";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
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
  useRouter: () => router,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
// N2 of notes: «Mencionado en» reads the database (tested in notes-backlinks.test.tsx).
vi.mock("@/lib/note-extensions", () => ({
  NoteMentions: ({ type, id }: { type: string; id: string }) => (
    <div data-note-mentions-slot={`${type}:${id}`} />
  ),
}));
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn() }));
vi.mock("@/modules/learning/queries", () => ({
  getTrack: vi.fn(),
  listSteps: vi.fn(),
  listActiveTracks: vi.fn(),
  listProjectChoices: vi.fn(),
  getRunningSession: vi.fn(),
  getTrackMinutes: vi.fn(),
  listTrackSessions: vi.fn(),
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

const TODAY = ownerDateKey(new Date());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const TRACK: TrackItem = {
  id: id(1),
  title: "AWS SAA",
  kind: "certification",
  status: "waiting",
  projectId: id(900),
  url: "https://www.udemy.com/course/aws",
  weeklyTargetMinutes: 180,
  targetDate: null,
  position: 0,
  finishedAt: null,
  steps: { done: 1, total: 3 },
  upcoming: [],
};

const step = (n: number, title: string, done = false): StepItem => ({
  id: id(100 + n),
  title,
  position: n,
  doneAt: done ? "2026-11-01T15:00:00.000Z" : null,
});
const STEPS = [step(0, "Clase 1", true), step(1, "Clase 2"), step(2, "Clase 3")];
const ACTIVE: TrackRef[] = [
  { id: id(2), title: "Platzi IA" },
  { id: id(3), title: "Inglés" },
];

function Detail({
  track = TRACK,
  steps = STEPS,
  active = [],
}: {
  track?: TrackItem;
  steps?: StepItem[];
  active?: TrackRef[];
}) {
  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      <TrackDetail
        track={track}
        steps={steps}
        projects={[{ id: id(900), name: "Ruta AWS + IA" }]}
        projectName="Ruta AWS + IA"
        active={active}
        today={TODAY}
        headingId="track-title"
      />
    </ScreenServicesProvider>
  );
}

const rowOf = (s: StepItem) => document.querySelector<HTMLElement>(`[data-step-row="${s.id}"]`)!;
const change = (patch: Partial<StatusChange> = {}): StatusChange => ({
  id: TRACK.id,
  title: TRACK.title,
  from: { status: "waiting", position: 0, finishedAt: null },
  to: "active",
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue(undefined as never);
  vi.mocked(getTrack).mockResolvedValue(TRACK);
  vi.mocked(listSteps).mockResolvedValue(STEPS);
  vi.mocked(listActiveTracks).mockResolvedValue([]);
  vi.mocked(listProjectChoices).mockResolvedValue([{ id: id(900), name: "Ruta AWS + IA" }]);
  vi.mocked(getRunningSession).mockResolvedValue(null);
  vi.mocked(getTrackMinutes).mockResolvedValue({});
  vi.mocked(listTrackSessions).mockResolvedValue([]);
});

describe("the page", () => {
  const params = (value: string) => ({ params: Promise.resolve({ id: value }) });

  test("checks the owner, reads the track, its steps, the tracks in progress and the projects", async () => {
    render(await TrackPage(params(TRACK.id)));
    expect(requireOwner).toHaveBeenCalled();
    expect(getTrack).toHaveBeenCalledWith(TRACK.id);
    expect(
      document.querySelector(`[data-note-mentions-slot="learning:${TRACK.id}"]`),
    ).toBeInTheDocument();
    expect(listSteps).toHaveBeenCalledWith(TRACK.id);
    expect(listProjectChoices).toHaveBeenCalledWith(id(900));
    expect(getRunningSession).toHaveBeenCalled();
    expect(listTrackSessions).toHaveBeenCalledWith(TRACK.id, expect.any(Date));
    expect(getTrackMinutes).toHaveBeenCalledWith(expect.any(Date), TRACK.id);
    expect(screen.getByRole("region", { name: "Sesiones" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "AWS SAA" })).toBeVisible();
    expect(screen.getByText("Certificación · En espera")).toBeVisible();
    expect(screen.getByRole("link", { name: "Proyecto: Ruta AWS + IA" })).toHaveAttribute(
      "href",
      `/projects/${id(900)}`,
    );
    const course = screen.getByRole("link", { name: COPY.linkName("udemy.com") });
    expect(course).toHaveAttribute("target", "_blank");
    expect(course).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: COPY.backToList })).toHaveAttribute(
      "href",
      "/learning",
    );
    expect((await generateMetadata(params(TRACK.id))).title).toBe(
      "AWS SAA · Aprendizaje · brahua-os",
    );
  });

  test("a missing track is a 404 (with its own title), and a refused owner reads nothing", async () => {
    vi.mocked(getTrack).mockResolvedValue(null);
    await expect(TrackPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(params("nope"))).title).toBe(COPY.notFoundTitle);
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    vi.mocked(getTrack).mockClear();
    await expect(TrackPage(params(TRACK.id))).rejects.toThrow("NEXT_REDIRECT");
    expect(getTrack).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  test("«Poner en curso» with room: the change, its notice and an exact «Deshacer»", async () => {
    const changes = [change()];
    vi.mocked(changeStatus).mockResolvedValue(
      ok({ track: { ...TRACK, status: "active" }, changes }),
    );
    vi.mocked(undoStatus).mockResolvedValue(ok({ restored: true }));
    render(<Detail active={[ACTIVE[0]]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.activate }));
    expect(changeStatus).toHaveBeenCalledWith({
      id: TRACK.id,
      to: "active",
      pauseTrackId: undefined,
    });
    expect(await screen.findByText("«AWS SAA» está en curso.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(undoStatus).toHaveBeenCalledWith({ changes });
    expect(await screen.findByText(COPY.statusRestored)).toBeVisible();
  });

  test("with 2 in progress it offers to move one to «En espera» instead of failing", async () => {
    vi.mocked(changeStatus).mockResolvedValue(
      ok({
        track: { ...TRACK, status: "active" },
        changes: [
          change({
            id: ACTIVE[1].id,
            title: "Inglés",
            from: { status: "active", position: 1, finishedAt: null },
            to: "waiting",
          }),
          change(),
        ],
      }),
    );
    render(<Detail active={ACTIVE} />);
    const activate = screen.getByRole("button", { name: COPY.activate });
    await userEvent.click(activate);
    expect(changeStatus).not.toHaveBeenCalled();
    const offer = screen.getByRole("region", { name: COPY.limitTitle });
    await waitFor(() =>
      expect(within(offer).getByRole("heading", { name: COPY.limitTitle })).toHaveFocus(),
    );
    // «Ahora no» closes it and gives focus back.
    await userEvent.click(within(offer).getByRole("button", { name: COPY.limitCancel }));
    expect(screen.queryByRole("region", { name: COPY.limitTitle })).toBeNull();
    await waitFor(() => expect(activate).toHaveFocus());
    // Again, and this time «Inglés» moves to «En espera» in the same request.
    await userEvent.click(activate);
    await userEvent.click(
      within(screen.getByRole("region", { name: COPY.limitTitle })).getByRole("button", {
        name: "Pasar «Inglés» a espera",
      }),
    );
    expect(changeStatus).toHaveBeenCalledWith({
      id: TRACK.id,
      to: "active",
      pauseTrackId: ACTIVE[1].id,
    });
    expect(await screen.findByText(COPY.swapped("Inglés", "AWS SAA"))).toBeVisible();
    expect(screen.queryByRole("region", { name: COPY.limitTitle })).toBeNull();
  });

  test("a stale limit from the server opens the offer too", async () => {
    vi.mocked(changeStatus).mockResolvedValue({
      ok: false,
      error: "Ya tienes 2 en curso. Pasa uno a «En espera» para empezar este.",
      fieldErrors: {
        pauseTrackId: ["Ya tienes 2 en curso. Pasa uno a «En espera» para empezar este."],
      },
    });
    render(<Detail active={[ACTIVE[0]]} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.activate }));
    expect(await screen.findByRole("region", { name: COPY.limitTitle })).toBeVisible();
  });

  test("«Terminar» celebrates (the core's, which respects reduced motion)", async () => {
    vi.mocked(changeStatus).mockResolvedValue(
      ok({
        track: { ...TRACK, status: "done" },
        changes: [change({ to: "done" })],
      }),
    );
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.finish }));
    expect(changeStatus).toHaveBeenCalledWith({
      id: TRACK.id,
      to: "done",
      pauseTrackId: undefined,
    });
    expect(await screen.findByText("«AWS SAA» está terminado.")).toBeVisible();
    expect(celebrate).toHaveBeenCalled();
  });

  test("with the syllabus complete it offers to finish", () => {
    render(<Detail track={{ ...TRACK, status: "active" }} steps={[step(0, "Clase 1", true)]} />);
    expect(screen.getByText(COPY.finishOffer)).toBeVisible();
  });

  test("«Eliminar» deletes it and goes to the list, which offers «Deshacer»", async () => {
    vi.mocked(deleteTrack).mockResolvedValue(ok({ id: TRACK.id, title: TRACK.title }));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.deleteTrack }));
    expect(deleteTrack).toHaveBeenCalledWith({ id: TRACK.id });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/learning?deleted=${TRACK.id}`));
  });

  test("a practice has no syllabus section", () => {
    render(
      <Detail track={{ ...TRACK, kind: "practice", steps: { done: 0, total: 0 } }} steps={[]} />,
    );
    expect(screen.queryByRole("heading", { name: /Temario/ })).toBeNull();
    expect(screen.getByText(COPY.practiceNote)).toBeVisible();
  });
});

describe("the syllabus", () => {
  test("the next step is marked; checking one is at once, with an exact «Deshacer»", async () => {
    vi.mocked(markStepDone).mockResolvedValue(
      ok({ step: { ...STEPS[1], doneAt: "2026-11-02T15:00:00.456Z" }, previous: null }),
    );
    vi.mocked(undoMarkStepDone).mockResolvedValue(ok(STEPS[1]));
    render(<Detail />);
    expect(within(rowOf(STEPS[1])).getByText(STEPS_COPY.next)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Temario, 1 de 3 pasos hechos" })).toBeVisible();
    await userEvent.click(
      within(rowOf(STEPS[1])).getByRole("checkbox", { name: "Clase 2: hecho" }),
    );
    expect(markStepDone).toHaveBeenCalledWith({ trackId: TRACK.id, id: STEPS[1].id, done: true });
    expect(await screen.findByText("«Clase 2» está hecho.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.undo }));
    expect(undoMarkStepDone).toHaveBeenCalledWith({
      trackId: TRACK.id,
      id: STEPS[1].id,
      expected: "2026-11-02T15:00:00.456Z",
      restore: null,
    });
  });

  test("unchecking a done step works the same way", async () => {
    vi.mocked(markStepDone).mockResolvedValue(
      ok({ step: { ...STEPS[0], doneAt: null }, previous: STEPS[0].doneAt }),
    );
    render(<Detail />);
    await userEvent.click(
      within(rowOf(STEPS[0])).getByRole("checkbox", { name: "Clase 1: hecho" }),
    );
    expect(markStepDone).toHaveBeenCalledWith({ trackId: TRACK.id, id: STEPS[0].id, done: false });
    expect(await screen.findByText("«Clase 1» volvió a quedar sin marcar.")).toBeVisible();
  });

  test("adds a step with Enter (a client id) and keeps the field for the next one", async () => {
    vi.mocked(addStep).mockImplementation(async (input) =>
      ok({ ...(input as StepItem), position: 3, doneAt: null }),
    );
    render(<Detail />);
    const field = screen.getByLabelText(STEPS_COPY.addLabel);
    await userEvent.type(field, "Clase 4{enter}");
    expect(addStep).toHaveBeenCalledWith({
      trackId: TRACK.id,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "Clase 4",
    });
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });

  test("«Pegar temario» adds every line at the end and offers «Deshacer»", async () => {
    vi.mocked(pasteSteps).mockResolvedValue(ok([step(3, "Clase 4"), step(4, "Clase 5")]));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: STEPS_COPY.paste }));
    const area = screen.getByLabelText(STEPS_COPY.pasteLabel);
    await waitFor(() => expect(area).toHaveFocus());
    await userEvent.type(area, "Clase 4{enter}{enter}Clase 5");
    expect(screen.getByText(/^2 pasos\./)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: STEPS_COPY.pasteSubmit }));
    expect(pasteSteps).toHaveBeenCalledWith({ trackId: TRACK.id, syllabus: "Clase 4\n\nClase 5" });
    expect(await screen.findByText(STEPS_COPY.pasted(2))).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.undo })).toBeVisible();
  });

  test("renames in its row (Enter saves) and focus comes back to the step", async () => {
    vi.mocked(renameStep).mockResolvedValue(ok({ ...STEPS[2], title: "Clase 3: S3" }));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: "Editar «Clase 3»" }));
    const field = screen.getByLabelText(STEPS_COPY.titleLabel);
    await userEvent.clear(field);
    await userEvent.type(field, "Clase 3: S3{enter}");
    expect(renameStep).toHaveBeenCalledWith({
      trackId: TRACK.id,
      id: STEPS[2].id,
      title: "Clase 3: S3",
    });
    await waitFor(() =>
      expect(document.querySelector(`[data-step-focus="edit:${STEPS[2].id}"]`)).toHaveFocus(),
    );
  });

  test("removes one at once; «Deshacer» puts it back after its neighbour", async () => {
    vi.mocked(deleteStep).mockResolvedValue(ok({ step: STEPS[1], position: 1 }));
    vi.mocked(undoDeleteStep).mockResolvedValue(ok(STEPS));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: "Editar «Clase 2»" }));
    await userEvent.click(screen.getByRole("button", { name: STEPS_COPY.remove }));
    expect(deleteStep).toHaveBeenCalledWith({ trackId: TRACK.id, id: STEPS[1].id });
    // Focus goes to the next step.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar «Clase 3»" })).toHaveFocus(),
    );
    await userEvent.click(await screen.findByRole("button", { name: COPY.undo }));
    expect(undoDeleteStep).toHaveBeenCalledWith({
      trackId: TRACK.id,
      id: STEPS[1].id,
      position: 1,
      afterId: STEPS[0].id,
    });
  });

  test("«Bajar» moves a step and sends the whole order; focus stays on the key", async () => {
    vi.mocked(reorderSteps).mockResolvedValue(ok([STEPS[1], STEPS[0], STEPS[2]]));
    render(<Detail />);
    const down = within(rowOf(STEPS[0])).getByRole("button", { name: "Bajar «Clase 1»" });
    await userEvent.click(down);
    expect(reorderSteps).toHaveBeenCalledWith({
      trackId: TRACK.id,
      ids: [STEPS[1].id, STEPS[0].id, STEPS[2].id],
    });
    expect(await screen.findByText("«Clase 1» pasó al lugar 2 de 3.")).toBeVisible();
  });

  test("a track without steps opens the paste form and says what to do", () => {
    render(<Detail steps={[]} track={{ ...TRACK, steps: { done: 0, total: 0 } }} />);
    expect(screen.getByText(STEPS_COPY.empty)).toBeVisible();
    expect(screen.getByLabelText(STEPS_COPY.pasteLabel)).toBeVisible();
  });
});
