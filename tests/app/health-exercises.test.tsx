// `health` E1: the catalogue and an exercise's page (queries mocked: what they read, the 404 and
// the authorization) and their screens against a fake server (actions mocked; the queue and the
// notices are the real ones): the search without case or accents, the group filter, «Nuevo
// ejercicio» (a repeated name stays on its field), editing and deleting an exercise.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ExercisePage, { generateMetadata } from "@/app/(app)/health/exercises/[id]/page";
import ExercisesPage from "@/app/(app)/health/exercises/page";
import { fail, INVALID_FIELDS_MESSAGE, ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ExerciseDetail } from "@/modules/health/components/exercise-detail";
import { ExercisesScreen } from "@/modules/health/components/exercises-screen";
import { createExercise, deleteExercise, updateExercise } from "@/modules/health/exercises-actions";
import { EXERCISE_ERRORS, EXERCISES_COPY as COPY } from "@/modules/health/exercises-copy";
import type { ExerciseItem } from "@/modules/health/exercises-input";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getDeletedExercise, getExercise, listExercises } from "@/modules/health/queries";

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
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  getDeletedExercise: vi.fn(),
  // E3's slot (tests/app/health-records.test.tsx covers it).
  getExerciseRecords: vi.fn(async () => ({
    records: [],
    lineMetric: "maxWeight",
    line: [],
    history: [],
    totalSessions: 0,
  })),
}));
vi.mock("@/modules/health/exercises-actions", () => ({
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}));
vi.mock("@/modules/health/routines-actions", () => ({ restoreRoutine: vi.fn() }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const exercise = (n: number, name: string, values: Partial<ExerciseItem> = {}): ExerciseItem => ({
  id: id(n),
  name,
  nameKey: name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
  kind: "weight_reps",
  muscleGroup: "quads",
  equipment: "barbell",
  perDumbbell: false,
  restSeconds: 90,
  ...values,
});
const EXERCISES = [
  exercise(1, "Sentadilla búlgara", { equipment: "dumbbell", perDumbbell: true }),
  exercise(2, "Sentadilla con barra"),
  exercise(3, "Press de banca con barra", { muscleGroup: "chest" }),
  exercise(4, "Plancha", { kind: "time", muscleGroup: "abs", equipment: "bodyweight" }),
];

function Screen() {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <ExercisesScreen exercises={EXERCISES} headingId="exercises-title" />
    </ScreenServicesProvider>
  );
}

function Detail({ value = EXERCISES[1] }: { value?: ExerciseItem }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <ExerciseDetail exercise={value} headingId="exercise-title" />
    </ScreenServicesProvider>
  );
}

const names = () =>
  [...document.querySelectorAll("[data-exercise-row]")].map(
    (row) => row.querySelector("a span")?.textContent,
  );

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
  vi.mocked(requireOwner).mockResolvedValue(undefined as never);
  vi.mocked(listExercises).mockResolvedValue(EXERCISES);
  vi.mocked(getDeletedExercise).mockResolvedValue(null);
  vi.mocked(getExercise).mockResolvedValue(EXERCISES[1]);
});

describe("the pages", () => {
  test("the catalogue checks the owner and lists every exercise by group", async () => {
    render(await ExercisesPage({ searchParams: Promise.resolve({}) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: COPY.pageTitle })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Pecho, 1 ejercicio" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Cuádriceps, 2 ejercicios" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Plancha/ })).toHaveAttribute(
      "href",
      `/health/exercises/${id(4)}`,
    );
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    vi.mocked(listExercises).mockClear();
    await expect(ExercisesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(listExercises).not.toHaveBeenCalled();
  });

  test("an exercise's page, its title, and the 404", async () => {
    const params = (value: string) => ({ params: Promise.resolve({ id: value }) });
    render(await ExercisePage(params(id(2))));
    expect(screen.getByRole("heading", { level: 1, name: "Sentadilla con barra" })).toBeVisible();
    expect(screen.getByText("Cuádriceps · Barra")).toBeVisible();
    expect((await generateMetadata(params(id(2)))).title).toBe(
      "Sentadilla con barra · Ejercicios · brahua-os",
    );
    vi.mocked(getExercise).mockResolvedValue(null);
    await expect(ExercisePage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(params("nope"))).title).toBe(COPY.notFoundTitle);
  });
});

describe("the catalogue", () => {
  test("the search ignores case and accents; the group narrows it", async () => {
    render(<Screen />);
    expect(names()).toHaveLength(4);
    await userEvent.type(screen.getByLabelText(COPY.searchLabel), "BULGARA");
    await waitFor(() => expect(names()).toEqual(["Sentadilla búlgara"]));
    expect(screen.getByText(/Mancuernas · Peso y repeticiones · Por mancuerna/)).toBeVisible();
    await userEvent.clear(screen.getByLabelText(COPY.searchLabel));
    await userEvent.type(screen.getByLabelText(COPY.searchLabel), "sentadilla");
    await waitFor(() => expect(names()).toHaveLength(2));
    await userEvent.selectOptions(screen.getByLabelText(COPY.groupFilter), "chest");
    expect(names()).toEqual([]);
    expect(screen.getByText(COPY.noResults)).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.createNamed("sentadilla") })).toBeVisible();
  });

  test("«Nuevo ejercicio»: a repeated name stays on its field; then it is created", async () => {
    vi.mocked(createExercise)
      .mockResolvedValueOnce({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { name: [EXERCISE_ERRORS.nameTaken] },
      })
      .mockResolvedValueOnce(ok(exercise(9, "Press Arnold", { muscleGroup: "shoulders" })));
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newExercise }));
    const dialog = await screen.findByRole("dialog", { name: COPY.newSheetTitle });
    const name = within(dialog).getByLabelText(COPY.nameLabel);
    await userEvent.type(name, "plancha");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createExercise).toHaveBeenCalledWith({
      name: "plancha",
      kind: "weight_reps",
      muscleGroup: "chest",
      equipment: "barbell",
      perDumbbell: false,
      restSeconds: 90,
    });
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription(expect.stringContaining(EXERCISE_ERRORS.nameTaken)),
    );
    expect(name).toHaveFocus();
    await userEvent.clear(name);
    await userEvent.type(name, "Press Arnold");
    await userEvent.selectOptions(within(dialog).getByLabelText(COPY.groupLabel), "shoulders");
    await userEvent.click(within(dialog).getByRole("switch", { name: COPY.perDumbbellLabel }));
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createExercise).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "Press Arnold",
        muscleGroup: "shoulders",
        perDumbbell: true,
      }),
    );
    expect(await screen.findByText(COPY.created("Press Arnold"))).toBeVisible();
  });

  test("a name left empty is refused before sending", async () => {
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newExercise }));
    const dialog = await screen.findByRole("dialog", { name: COPY.newSheetTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.create }));
    expect(createExercise).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(COPY.nameLabel)).toHaveAccessibleDescription(
      expect.stringContaining(EXERCISE_ERRORS.nameRequired),
    );
  });
});

describe("an exercise's page", () => {
  test("saves every field and says so", async () => {
    vi.mocked(updateExercise).mockResolvedValue(ok({ ...EXERCISES[1], restSeconds: 120 }));
    render(<Detail />);
    await userEvent.selectOptions(screen.getByLabelText(COPY.restLabel), "120");
    await userEvent.click(screen.getByRole("button", { name: HEALTH_COPY.save }));
    expect(updateExercise).toHaveBeenCalledWith({
      id: id(2),
      name: "Sentadilla con barra",
      kind: "weight_reps",
      muscleGroup: "quads",
      equipment: "barbell",
      perDumbbell: false,
      restSeconds: 120,
    });
    expect(await screen.findByText(COPY.saved("Sentadilla con barra"))).toBeVisible();
  });

  test("a refusal without a field (in a routine) is a notice that names the routine", async () => {
    vi.mocked(updateExercise).mockResolvedValue(fail(EXERCISE_ERRORS.inRoutine("Rutina A")));
    render(<Detail />);
    await userEvent.selectOptions(screen.getByLabelText(COPY.kindLabel), "time");
    await userEvent.click(screen.getByRole("button", { name: HEALTH_COPY.save }));
    expect(await screen.findByText(/Está en la rutina «Rutina A»/)).toBeVisible();
  });

  test("«Eliminar» deletes it and goes to the catalogue, which offers «Deshacer»", async () => {
    vi.mocked(deleteExercise).mockResolvedValue(ok({ id: id(2), name: "Sentadilla con barra" }));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.deleteExercise }));
    expect(deleteExercise).toHaveBeenCalledWith({ id: id(2) });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/health/exercises?deleted=${id(2)}`),
    );
  });
});
