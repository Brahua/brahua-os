// T1: the quick capture sheet (SPEC-tasks: under 10 s on the phone; Enter saves; ready for the
// next one; area/project and date visible and optional; priority under "Más detalles").
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { createTask, listTaskTargets } from "@/modules/tasks/actions";
import { QuickCaptureSheet } from "@/modules/tasks/components/quick-capture-sheet";
import { TASK_ERRORS, type TaskItem, type TaskTargets } from "@/modules/tasks/task-input";

vi.mock("@/modules/tasks/actions", () => ({ createTask: vi.fn(), listTaskTargets: vi.fn() }));

const HEALTH_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const HEALTH = {
  id: HEALTH_ID,
  slug: "health",
  name: "Salud",
  icon: "heart-pulse",
  color: "health",
} as const;
const HOME = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
} as const;
const TARGETS: TaskTargets = {
  areas: [HEALTH, HOME],
  projects: [{ id: PROJECT_ID, name: "Cocina", status: "active", area: HOME }],
};

const saved = (title: string): TaskItem => ({
  id: "44444444-4444-4444-8444-444444444444",
  title,
  priority: "medium",
  dueDate: null,
  doneAt: null,
  createdAt: new Date(),
  lifeAreaId: null,
  projectId: null,
  milestoneId: null,
  isNextAction: false,
  area: null,
  project: null,
  recurrence: null,
  tags: [],
});

/** Calls to createTask wait until the test answers them. */
let answers: ((result: ActionResult<TaskItem>) => void)[] = [];

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  answers = [];
  vi.mocked(listTaskTargets).mockReset().mockResolvedValue(ok(TARGETS));
  vi.mocked(createTask)
    .mockReset()
    .mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
});

async function answer(result: ActionResult<TaskItem>) {
  const next = answers.shift();
  if (!next) throw new Error("No pending createTask");
  await act(async () => next(result));
}

function renderSheet() {
  const onOpenChange = vi.fn();
  render(<QuickCaptureSheet open onOpenChange={onOpenChange} returnFocusRef={createRef()} />);
  return { onOpenChange };
}

const titleField = () => screen.getByRole("textbox", { name: "¿Qué hay que hacer?" });
const placementField = () => screen.getByRole("combobox", { name: "Área o proyecto" });
const status = () => document.querySelector("[data-capture-status]")!;

describe("QuickCaptureSheet", () => {
  test("opens with the title focused and area/project and date visible; priority folded", async () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Nueva tarea" })).toBeInTheDocument();
    await waitFor(() => expect(titleField()).toHaveFocus());
    expect(placementField()).toBeVisible();
    expect(screen.getByLabelText("Fecha límite")).toBeVisible();
    const more = screen.getByRole("button", { name: "Más detalles" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup", { name: "Prioridad" })).toBeNull();
    // The areas and projects arrive when it opens.
    await waitFor(() =>
      expect(within(placementField()).getByRole("option", { name: "Salud" })).toBeInTheDocument(),
    );
    expect(
      within(placementField()).getByRole("option", { name: "Cocina · Hogar" }),
    ).toBeInTheDocument();
    expect(placementField()).toHaveValue("");
  });

  test("Enter saves to the inbox; the field is empty and focused again, and it says so", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "  comprar   pilas{Enter}");
    expect(createTask).toHaveBeenCalledWith({
      title: "comprar pilas",
      lifeAreaId: null,
      projectId: null,
      milestoneId: null,
      dueDate: null,
      priority: "medium",
    });
    expect(screen.getByRole("button", { name: "Agregando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(status()).toHaveTextContent("Agregando tarea…");
    // A second Enter while saving sends nothing.
    await user.type(titleField(), "{Enter}");
    expect(createTask).toHaveBeenCalledTimes(1);

    await answer(ok(saved("comprar pilas")));
    expect(titleField()).toHaveValue("");
    expect(titleField()).toHaveFocus();
    await waitFor(() => expect(status()).toHaveTextContent("Tarea agregada a la bandeja."));
  });

  test("with an area, a date and Alta; the status names where it went; then back to defaults", async () => {
    const user = userEvent.setup();
    renderSheet();
    await waitFor(() =>
      expect(within(placementField()).getByRole("option", { name: "Salud" })).toBeInTheDocument(),
    );
    await user.selectOptions(placementField(), "Salud");
    await user.type(screen.getByLabelText("Fecha límite"), "2026-10-31");
    await user.click(screen.getByRole("button", { name: "Más detalles" }));
    await user.click(screen.getByRole("radio", { name: "Alta" }));
    await user.type(titleField(), "pedir cita{Enter}");
    expect(createTask).toHaveBeenCalledWith({
      title: "pedir cita",
      lifeAreaId: HEALTH_ID,
      projectId: null,
      milestoneId: null,
      dueDate: "2026-10-31",
      priority: "high",
    });
    await answer(ok(saved("pedir cita")));
    await waitFor(() => expect(status()).toHaveTextContent("Tarea agregada a «Salud»."));
    expect(placementField()).toHaveValue("");
    expect(screen.getByLabelText("Fecha límite")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Media" })).toHaveAttribute("aria-checked", "true");
  });

  test("a project goes as projectId (its area is the project's)", async () => {
    const user = userEvent.setup();
    renderSheet();
    await waitFor(() =>
      expect(
        within(placementField()).getByRole("option", { name: "Cocina · Hogar" }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(placementField(), "Cocina · Hogar");
    await user.type(titleField(), "medir paredes{Enter}");
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, lifeAreaId: null }),
    );
    await answer(ok(saved("medir paredes")));
  });

  test("an empty title is an error on the field and sends nothing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(titleField(), "   {Enter}");
    expect(createTask).not.toHaveBeenCalled();
    expect(titleField()).toHaveAccessibleDescription(TASK_ERRORS.titleRequired);
    expect(titleField()).toHaveFocus();
  });

  test("a refused area keeps the text, shows the error on the picker and focuses it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await waitFor(() =>
      expect(within(placementField()).getByRole("option", { name: "Salud" })).toBeInTheDocument(),
    );
    await user.selectOptions(placementField(), "Salud");
    await user.type(titleField(), "pedir cita{Enter}");
    await answer({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [TASK_ERRORS.areaUnavailable] },
    });
    expect(titleField()).toHaveValue("pedir cita");
    expect(placementField()).toHaveAccessibleDescription(TASK_ERRORS.areaUnavailable);
    await waitFor(() => expect(placementField()).toHaveFocus());
  });

  test("a network failure keeps the text and says why", async () => {
    const user = userEvent.setup();
    vi.mocked(createTask).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderSheet();
    await user.type(titleField(), "llamar a mamá{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
    expect(titleField()).toHaveValue("llamar a mamá");
  });

  test("if the areas can't load, the inbox still works and it says so", async () => {
    vi.mocked(listTaskTargets).mockResolvedValueOnce(fail("x"));
    const user = userEvent.setup();
    renderSheet();
    await waitFor(() =>
      expect(placementField()).toHaveAccessibleDescription(/No se pudieron cargar/),
    );
    await user.type(titleField(), "x{Enter}");
    expect(createTask).toHaveBeenCalled();
    await answer(ok(saved("x")));
  });

  test("Cerrar closes it, but not while saving", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderSheet();
    await user.type(titleField(), "x{Enter}");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await answer(ok(saved("x")));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
