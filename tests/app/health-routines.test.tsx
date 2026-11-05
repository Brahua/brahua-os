// `health` E1: /health and a routine's page (queries mocked: what they read, the 404 and the
// authorization) and their screens against a fake server (actions mocked; the queue, notices and
// focus are the real ones): «Nueva rutina», the routines' order with «Deshacer», the name in
// place, adding from the catalogue (and «Nuevo ejercicio» from the picker), the targets in their
// row, removing with «Deshacer», and deleting the routine.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HealthPage from "@/app/(app)/health/page";
import RoutinePage, { generateMetadata } from "@/app/(app)/health/routines/[id]/page";
import { ok } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { RoutineDetail } from "@/modules/health/components/routine-detail";
import { RoutinesSection } from "@/modules/health/components/routines-section";
import { createExercise } from "@/modules/health/exercises-actions";
import type { ExerciseItem } from "@/modules/health/exercises-input";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import {
  getDeletedRoutine,
  getRoutine,
  listExercises,
  listRoutineItems,
  listRoutines,
} from "@/modules/health/queries";
import {
  addRoutineItem,
  createRoutine,
  deleteRoutine,
  removeRoutineItem,
  renameRoutine,
  reorderRoutines,
  restoreRoutineItem,
  updateRoutineItem,
} from "@/modules/health/routines-actions";
import { ROUTINES_COPY as COPY } from "@/modules/health/routines-copy";
import type { RoutineItem, RoutineSummary } from "@/modules/health/routines-input";

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
  getRoutine: vi.fn(),
  listRoutineItems: vi.fn(),
  getDeletedRoutine: vi.fn(),
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  getDeletedExercise: vi.fn(),
  // E2's slots on /health (tests/app/health-sessions.test.tsx covers them).
  getOpenSession: vi.fn(async () => null),
  getNextRoutine: vi.fn(async () => null),
  listSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
  // E4's «Ajustes» row (tests/app/health-habit.test.tsx covers it).
  getHealthSettings: vi.fn(async () => ({ habitId: null, options: [] })),
}));
vi.mock("@/modules/health/settings-actions", () => ({ updateHealthSettings: vi.fn() }));
vi.mock("@/modules/health/sessions-actions", () => ({ startHealthSession: vi.fn() }));
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
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROUTINES: RoutineSummary[] = [
  { id: id(1), name: "Rutina A", position: 0, exerciseCount: 2 },
  { id: id(2), name: "Rutina B", position: 1, exerciseCount: 0 },
];

const exercise = (n: number, name: string, values: Partial<ExerciseItem> = {}): ExerciseItem => ({
  id: id(100 + n),
  name,
  nameKey: name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
  kind: "weight_reps",
  muscleGroup: "quads",
  equipment: "barbell",
  perDumbbell: false,
  restSeconds: 90,
  ...values,
});
const SQUAT = exercise(1, "Sentadilla con barra");
const BULGARIAN = exercise(2, "Sentadilla búlgara", { equipment: "dumbbell", perDumbbell: true });
const PLANK = exercise(3, "Plancha", { kind: "time", muscleGroup: "abs", equipment: "bodyweight" });
const EXERCISES = [SQUAT, BULGARIAN, PLANK];

const item = (n: number, from: ExerciseItem, values: Partial<RoutineItem> = {}): RoutineItem => ({
  id: id(200 + n),
  exerciseId: from.id,
  exerciseName: from.name,
  kind: from.kind,
  equipment: from.equipment,
  perDumbbell: from.perDumbbell,
  exerciseRestSeconds: from.restSeconds,
  position: n,
  targetSets: 4,
  repsMin: 6,
  repsMax: 8,
  targetSeconds: null,
  restSeconds: 120,
  ...values,
});
const ITEMS = [
  item(0, SQUAT),
  item(1, PLANK, {
    targetSets: 3,
    repsMin: null,
    repsMax: null,
    targetSeconds: 45,
    restSeconds: null,
  }),
];

function Section({ routines = ROUTINES }: { routines?: RoutineSummary[] }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <RoutinesSection routines={routines} />
    </ScreenServicesProvider>
  );
}

function Detail({ items = ITEMS }: { items?: RoutineItem[] }) {
  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <RoutineDetail
        routine={{ id: id(1), name: "Rutina A" }}
        items={items}
        exercises={EXERCISES}
        headingId="routine-title"
      />
    </ScreenServicesProvider>
  );
}

const rowOf = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-order-row="${rowId}"]`)!;

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
  vi.mocked(listRoutines).mockResolvedValue(ROUTINES);
  vi.mocked(getDeletedRoutine).mockResolvedValue(null);
  vi.mocked(getRoutine).mockResolvedValue({ id: id(1), name: "Rutina A" });
  vi.mocked(listRoutineItems).mockResolvedValue(ITEMS);
  vi.mocked(listExercises).mockResolvedValue(EXERCISES);
});

describe("the pages", () => {
  test("/health checks the owner, reads the routines and links the catalogue", async () => {
    render(await HealthPage({ searchParams: Promise.resolve({}) }));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: HEALTH_COPY.pageTitle })).toBeVisible();
    expect(screen.getByRole("link", { name: /Rutina A/ })).toHaveAttribute(
      "href",
      `/health/routines/${id(1)}`,
    );
    expect(screen.getByText("2 ejercicios")).toBeVisible();
    expect(screen.getByRole("link", { name: /Ejercicios/ })).toHaveAttribute(
      "href",
      "/health/exercises",
    );
    expect(getDeletedRoutine).not.toHaveBeenCalled();
  });

  test("/health without routines: «Arma tu primera rutina»; a refused owner reads nothing", async () => {
    vi.mocked(listRoutines).mockResolvedValue([]);
    render(await HealthPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: HEALTH_COPY.emptyTitle })).toBeVisible();
    expect(screen.getByRole("button", { name: COPY.newRoutine })).toBeVisible();
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    vi.mocked(listRoutines).mockClear();
    await expect(HealthPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(listRoutines).not.toHaveBeenCalled();
  });

  test("a routine's page reads it, its exercises and the catalogue; a missing one is a 404", async () => {
    const params = (value: string) => ({ params: Promise.resolve({ id: value }) });
    render(await RoutinePage(params(id(1))));
    expect(requireOwner).toHaveBeenCalled();
    expect(listRoutineItems).toHaveBeenCalledWith(id(1));
    expect(listExercises).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Rutina A" })).toBeVisible();
    // «Empezar esta rutina» (E2) goes first among its actions.
    expect(
      within(screen.getByRole("group", { name: COPY.actionsLabel })).getAllByRole("button")[0],
    ).toHaveAccessibleName("Empezar esta rutina");
    expect((await generateMetadata(params(id(1)))).title).toBe("Rutina A · Entreno · brahua-os");
    vi.mocked(getRoutine).mockResolvedValue(null);
    await expect(RoutinePage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(params("nope"))).title).toBe(COPY.notFoundTitle);
  });
});

describe("the routines on /health", () => {
  test("«Nueva rutina» creates one and opens it", async () => {
    vi.mocked(createRoutine).mockResolvedValue(
      ok({ id: id(3), name: "Rutina C", position: 2, exerciseCount: 0 }),
    );
    render(<Section />);
    await userEvent.click(screen.getByRole("button", { name: COPY.newRoutine }));
    expect(createRoutine).toHaveBeenCalledWith({});
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/health/routines/${id(3)}`));
  });

  test("«Bajar» moves it at once, keeps focus on the key and offers «Deshacer»", async () => {
    // The save waits until the focus is checked: while it is on its way the list shows the move.
    let finish: (value: Awaited<ReturnType<typeof reorderRoutines>>) => void = () => {};
    vi.mocked(reorderRoutines).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    vi.mocked(reorderRoutines).mockResolvedValue(ok([]));
    render(<Section />);
    // The lazy dnd-kit layer has replaced the plain list (its handles carry a role description).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.drag("Rutina A") })).toHaveAttribute(
        "aria-roledescription",
        COPY.dragRole,
      ),
    );
    try {
      await userEvent.click(screen.getByRole("button", { name: COPY.moveDown("Rutina A") }));
      await waitFor(() => expect(reorderRoutines).toHaveBeenCalledWith({ ids: [id(2), id(1)] }));
      const links = within(screen.getByRole("list", { name: COPY.listLabel })).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([
        expect.stringContaining("Rutina B"),
        expect.stringContaining("Rutina A"),
      ]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: COPY.moveDown("Rutina A") })).toHaveFocus(),
      );
    } finally {
      finish(ok([]));
    }
    expect(await screen.findByText("«Rutina A» pasó al lugar 2 de 2.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: HEALTH_COPY.undo }));
    await waitFor(() => expect(reorderRoutines).toHaveBeenLastCalledWith({ ids: [id(1), id(2)] }));
  });

  test("the first «Subir» and the last «Bajar» do nothing (aria-disabled, still focusable)", async () => {
    render(<Section />);
    const up = screen.getByRole("button", { name: COPY.moveUp("Rutina A") });
    expect(up).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(up);
    expect(reorderRoutines).not.toHaveBeenCalled();
  });
});

describe("a routine's page", () => {
  test("shows each exercise with its targets and rest", () => {
    render(<Detail />);
    expect(screen.getByRole("heading", { name: "Ejercicios, 2 de 30" })).toBeVisible();
    expect(within(rowOf(ITEMS[0].id)).getByText(/4 × 6–8 · Descanso 2 min/)).toBeVisible();
    expect(
      within(rowOf(ITEMS[1].id)).getByText(/3 × 45 s · Descanso 1 min 30 s \(del ejercicio\)/),
    ).toBeVisible();
  });

  test("renames in place (Enter saves) and focus comes back to the key", async () => {
    vi.mocked(renameRoutine).mockResolvedValue(ok({ id: id(1), name: "Piernas" }));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.rename("Rutina A") }));
    const field = screen.getByLabelText(COPY.nameLabel);
    await userEvent.clear(field);
    await userEvent.type(field, "Piernas{enter}");
    await waitFor(() => expect(renameRoutine).toHaveBeenCalledWith({ id: id(1), name: "Piernas" }));
    expect(await screen.findByText(COPY.renamed)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-routine-rename]")).toHaveFocus());
  });

  test("adds from the catalogue (search without accents) with the kind's default targets", async () => {
    vi.mocked(addRoutineItem).mockImplementation(async (input) =>
      ok({ ...item(2, BULGARIAN), ...(input as object) } as RoutineItem),
    );
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.addItem }));
    const search = await screen.findByLabelText(COPY.pickerSearch);
    await userEvent.type(search, "BULGARA");
    const list = screen.getByRole("list", { name: COPY.pickerList });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(
      within(list).getByRole("button", { name: COPY.pickerAdd(BULGARIAN.name) }),
    );
    await waitFor(() => expect(addRoutineItem).toHaveBeenCalled());
    expect(addRoutineItem).toHaveBeenCalledWith({
      routineId: id(1),
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      exerciseId: BULGARIAN.id,
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      targetSeconds: null,
      restSeconds: null,
    });
    expect(await screen.findByText(COPY.added(BULGARIAN.name))).toBeInTheDocument();
  });

  test("«Nuevo ejercicio» from the picker creates it with the typed name and adds it", async () => {
    const created = exercise(9, "Press Arnold", { muscleGroup: "shoulders" });
    vi.mocked(createExercise).mockResolvedValue(ok(created));
    vi.mocked(addRoutineItem).mockResolvedValue(ok(item(2, created)));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.addItem }));
    await userEvent.type(await screen.findByLabelText(COPY.pickerSearch), "Press Arnold");
    expect(screen.getByText(COPY.pickerNone, { selector: "p:not([role=status])" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: COPY.pickerCreate("Press Arnold") }));
    const name = await screen.findByRole("textbox", { name: "Nombre" });
    expect(name).toHaveValue("Press Arnold");
    await userEvent.click(screen.getByRole("button", { name: "Crear ejercicio" }));
    expect(createExercise).toHaveBeenCalledWith(expect.objectContaining({ name: "Press Arnold" }));
    await waitFor(() =>
      expect(addRoutineItem).toHaveBeenCalledWith(
        expect.objectContaining({ exerciseId: created.id, repsMin: 8, repsMax: 12 }),
      ),
    );
  });

  test("edits the targets in its row; a time exercise asks for seconds", async () => {
    vi.mocked(updateRoutineItem).mockResolvedValue(ok(ITEMS[1]));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.editItem("Plancha") }));
    expect(screen.queryByLabelText(COPY.repsMinLabel)).toBeNull();
    const seconds = screen.getByLabelText(COPY.secondsLabel);
    await userEvent.clear(seconds);
    await userEvent.type(seconds, "60");
    await userEvent.click(screen.getByRole("button", { name: HEALTH_COPY.save }));
    expect(updateRoutineItem).toHaveBeenCalledWith({
      routineId: id(1),
      id: ITEMS[1].id,
      targetSets: 3,
      repsMin: null,
      repsMax: null,
      targetSeconds: 60,
      restSeconds: null,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.editItem("Plancha") })).toHaveFocus(),
    );
  });

  test("a wrong target is an error on its field and nothing is sent", async () => {
    render(<Detail />);
    await userEvent.click(
      screen.getByRole("button", { name: COPY.editItem("Sentadilla con barra") }),
    );
    const max = screen.getByLabelText(COPY.repsMaxLabel);
    await userEvent.clear(max);
    await userEvent.type(max, "4{enter}");
    expect(updateRoutineItem).not.toHaveBeenCalled();
    expect(max).toHaveAccessibleDescription(expect.stringContaining("El mínimo no puede pasar"));
    expect(max).toHaveFocus();
  });

  test("removes one at once; «Deshacer» puts it back after its neighbour", async () => {
    vi.mocked(removeRoutineItem).mockResolvedValue(ok({ item: ITEMS[0], position: 0 }));
    vi.mocked(restoreRoutineItem).mockResolvedValue(ok(ITEMS));
    render(<Detail />);
    await userEvent.click(
      screen.getByRole("button", { name: COPY.editItem("Sentadilla con barra") }),
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.removeItem }));
    expect(removeRoutineItem).toHaveBeenCalledWith({ routineId: id(1), id: ITEMS[0].id });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.editItem("Plancha") })).toHaveFocus(),
    );
    await userEvent.click(await screen.findByRole("button", { name: HEALTH_COPY.undo }));
    expect(restoreRoutineItem).toHaveBeenCalledWith({
      routineId: id(1),
      id: ITEMS[0].id,
      position: 0,
      afterId: null,
    });
  });

  test("«Eliminar rutina» deletes it and goes to /health, which offers «Deshacer»", async () => {
    vi.mocked(deleteRoutine).mockResolvedValue(ok({ id: id(1), name: "Rutina A" }));
    render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: COPY.deleteRoutine }));
    expect(deleteRoutine).toHaveBeenCalledWith({ id: id(1) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/health?deleted=${id(1)}`));
  });
});
