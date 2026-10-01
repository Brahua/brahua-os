// P3 on a project's page: milestones (add, check, edit, delete and undo, Subir/Bajar) with an
// optimistic view and the server as the source of truth, and the progress meter it drives.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectProgress } from "@/app/(app)/projects/[id]/_components/milestone-progress";
import { ProjectDetailProvider } from "@/app/(app)/projects/[id]/_components/project-detail-context";
import { ProjectMilestonesSection } from "@/app/(app)/projects/[id]/_components/project-milestones-section";
import { ProjectPlanSection } from "@/app/(app)/projects/[id]/_components/project-plan-section";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ProjectCard } from "@/modules/projects/components/project-card";
import {
  addMilestone,
  checkMilestone,
  deleteMilestone,
  reorderMilestones,
  restoreMilestone,
  updateMilestone,
} from "@/modules/projects/milestone-actions";
import { MILESTONE_ERRORS, type ProjectMilestoneItem } from "@/modules/projects/milestone-input";
import { countMilestones, milestoneProgress } from "@/modules/projects/progress";
import type { ProjectSummary } from "@/modules/projects/project-input";

// jsdom has no custom elements upgrade for NumberFlow's digits; the figure itself is enough here.
vi.mock("@number-flow/react", () => ({ default: ({ value }: { value: number }) => <>{value}</> }));
vi.mock("@/modules/projects/actions", () => ({
  updateProjectObjective: vi.fn(),
  updateProjectDates: vi.fn(),
}));
vi.mock("@/modules/projects/milestone-actions", () => ({
  addMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  checkMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  restoreMilestone: vi.fn(),
  reorderMilestones: vi.fn(),
}));

const NOW = new Date("2026-10-01T15:00:00.000Z");
const DONE_AT = new Date("2026-09-20T15:00:00.000Z");

const PROJECT: ProjectSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Cocina",
  objective: null,
  status: "active",
  priority: "medium",
  startDate: null,
  dueDate: null,
  completedAt: null,
  area: { id: "a", slug: "home", name: "Hogar", color: "home", icon: "house" },
};

const milestone = (
  id: string,
  title: string,
  sortOrder: number,
  extra = {},
): ProjectMilestoneItem => ({
  id,
  title,
  dueDate: null,
  doneAt: null,
  sortOrder,
  ...extra,
});

// Real uuids: the editor validates with the action's schema.
const M1 = "00000000-0000-4000-8000-0000000000a1";
const M2 = "00000000-0000-4000-8000-0000000000a2";
const M3 = "00000000-0000-4000-8000-0000000000a3";
const PLANOS = milestone(M1, "Planos", 0, { doneAt: DONE_AT });
const MUEBLES = milestone(M2, "Muebles", 1, { dueDate: "2026-11-30" });
const LUCES = milestone(M3, "Luces", 2);
const MILESTONES = [PLANOS, MUEBLES, LUCES];

type State = { project: ProjectSummary; milestones: ProjectMilestoneItem[] };

/**
 * A fake server: each action call waits until the test answers it (in order), then applies the
 * change and re-renders the page with it, like the action's revalidation. Every call must settle
 * before the test ends: React entangles pending async transitions.
 */
const server = {
  state: { project: PROJECT, milestones: MILESTONES } as State,
  render: (() => {}) as (state: State) => void,
  pending: [] as { answer: (result?: ActionResult<unknown>) => void }[],
  async answer(result?: ActionResult<unknown>) {
    const call = server.pending.shift();
    if (!call) throw new Error("No pending call");
    await act(async () => call.answer(result));
  },
  async answerAll() {
    while (server.pending.length > 0) await server.answer();
  },
};

function serverCall(
  apply: (milestones: ProjectMilestoneItem[]) => ProjectMilestoneItem[],
): Promise<ActionResult<unknown>> {
  return new Promise((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          const milestones = apply(server.state.milestones).map((item, sortOrder) => ({
            ...item,
            sortOrder,
          }));
          server.state = { ...server.state, milestones };
          server.render(server.state);
        }
        resolve(result ?? ok(null));
      },
    });
  });
}

type Input = Record<string, unknown> & { id: string };

function Page({ initial }: { initial: State }) {
  const [state, setState] = useState(initial);
  useLayoutEffect(() => {
    server.render = setState;
  }, []);
  return (
    <ProjectDetailProvider project={state.project} now={NOW}>
      <ProjectPlanSection
        progress={<ProjectProgress counts={countMilestones(state.milestones)} />}
      />
      <ProjectMilestonesSection milestones={state.milestones} />
    </ProjectDetailProvider>
  );
}

async function renderPage(state: Partial<State> = {}) {
  server.state = { project: PROJECT, milestones: MILESTONES, ...state };
  const user = userEvent.setup();
  render(<Page initial={server.state} />);
  if (server.state.milestones.length > 1) {
    // The lazy dnd-kit layer replaces the plain list.
    await waitFor(
      () =>
        expect(screen.getAllByRole("button", { name: /^Mover / })[0]).toHaveAttribute(
          "aria-roledescription",
        ),
      // The first test pays for the lazy dnd-kit import.
      { timeout: 4000 },
    );
  }
  return user;
}

const list = () => screen.getByRole("list", { name: "Hitos del proyecto" });
const titles = () =>
  within(list())
    .getAllByRole("button", { name: /^Editar hito / })
    .map((button) => button.getAttribute("aria-label")!.replace(/^Editar hito /, ""));
const meter = () => screen.queryByRole("meter");
const addField = () => screen.getByRole("textbox", { name: "Nuevo hito" });
const notices = () => screen.getByRole("region", { name: "Avisos" });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.pending = [];
  vi.mocked(addMilestone)
    .mockReset()
    .mockImplementation((input) => {
      const { id, title } = input as Input;
      return serverCall((items) => [
        ...items,
        milestone(id, title as string, items.length),
      ]) as never;
    });
  vi.mocked(checkMilestone)
    .mockReset()
    .mockImplementation((input) => {
      const { id, done } = input as Input;
      return serverCall((items) =>
        items.map((item) => (item.id === id ? { ...item, doneAt: done ? NOW : null } : item)),
      ) as never;
    });
  vi.mocked(updateMilestone)
    .mockReset()
    .mockImplementation((input) => {
      const { id, title, dueDate } = input as Input;
      return serverCall((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, title: title as string, dueDate: dueDate as string | null }
            : item,
        ),
      ) as never;
    });
  vi.mocked(deleteMilestone)
    .mockReset()
    .mockImplementation((input) => {
      const { id } = input as Input;
      return serverCall((items) => items.filter((item) => item.id !== id)) as never;
    });
  vi.mocked(restoreMilestone)
    .mockReset()
    .mockImplementation((input) => {
      const { id, title, dueDate, doneAt, position } = input as Input;
      return serverCall((items) => {
        const next = [...items];
        next.splice(position as number, 0, {
          id,
          title: title as string,
          dueDate: dueDate as string | null,
          doneAt: doneAt ? new Date(doneAt as string) : null,
          sortOrder: 0,
        });
        return next;
      }) as never;
    });
  vi.mocked(reorderMilestones)
    .mockReset()
    .mockImplementation((input) => {
      const { ids } = input as { ids: string[] };
      return serverCall((items) => ids.map((id) => items.find((item) => item.id === id)!)) as never;
    });
});

afterEach(async () => {
  await server.answerAll();
});

describe("list and progress", () => {
  test("rows with a checkbox, the date, and the meter under the dates", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Hitos, 3 hitos" })).toBeInTheDocument();
    expect(titles()).toEqual(["Planos", "Muebles", "Luces"]);
    expect(screen.getByRole("checkbox", { name: "Hecho: Planos" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hecho: Muebles" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Editar hito Muebles" })).toHaveAccessibleDescription(
      "Para el 30 nov. 2026",
    );
    expect(meter()).toHaveAccessibleName("Avance: 33%, 1 de 3 hitos");
    expect(meter()).toHaveAttribute("aria-valuenow", "1");
    expect(meter()).toHaveAttribute("aria-valuemax", "3");
    // The meter is inside "Objetivo y fechas".
    const plan = screen.getByRole("region", { name: "Objetivo y fechas" });
    expect(within(plan).getByRole("meter")).toBe(meter());
  });

  test("without milestones: an explanation, the add field, and no meter (never 0 %)", async () => {
    await renderPage({ milestones: [] });
    expect(screen.getByRole("heading", { level: 2, name: "Hitos" })).toBeInTheDocument();
    expect(screen.getByText(/^Sin hitos\./)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Hitos del proyecto" })).toBeNull();
    expect(addField()).toBeInTheDocument();
    expect(meter()).toBeNull();
  });

  test("in Mantenimiento the milestones stay but there is no progress", async () => {
    await renderPage({ project: { ...PROJECT, status: "maintenance" } });
    expect(titles()).toHaveLength(3);
    expect(meter()).toBeNull();
  });
});

describe("add", () => {
  test("Enter adds at once and leaves the field empty and focused for another", async () => {
    const user = await renderPage();
    await user.type(addField(), "Encimera{Enter}");
    expect(titles()).toEqual(["Planos", "Muebles", "Luces", "Encimera"]);
    expect(addField()).toHaveValue("");
    expect(addField()).toHaveFocus();
    expect(meter()).toHaveAccessibleName("Avance: 25%, 1 de 4 hitos");
    await user.type(addField(), "Pintura{Enter}");
    expect(titles()).toEqual(["Planos", "Muebles", "Luces", "Encimera", "Pintura"]);

    const [first] = vi.mocked(addMilestone).mock.calls[0] as [Input];
    expect(first).toEqual({
      projectId: PROJECT.id,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "Encimera",
    });
    await server.answerAll();
    expect(titles()).toEqual(["Planos", "Muebles", "Luces", "Encimera", "Pintura"]);
    await waitFor(() =>
      expect(document.querySelector("[data-detail-announcer]")).toHaveTextContent(
        "Hito «Pintura» agregado.",
      ),
    );
  });

  test("an empty title says so on the field and sends nothing", async () => {
    const user = await renderPage();
    await user.type(addField(), "   {Enter}");
    expect(addField()).toHaveAccessibleDescription(MILESTONE_ERRORS.titleRequired);
    expect(addField()).toHaveFocus();
    expect(addMilestone).not.toHaveBeenCalled();
  });

  test("a refusal takes it out again and says why", async () => {
    const user = await renderPage({ milestones: [] });
    await user.type(addField(), "Planos{Enter}");
    expect(screen.getByRole("button", { name: "Editar hito Planos" })).toBeInTheDocument();
    await server.answer(fail(MILESTONE_ERRORS.tooMany));
    expect(screen.queryByRole("button", { name: "Editar hito Planos" })).toBeNull();
    expect(notices()).toHaveTextContent(
      `No se pudo agregar el hito; se quitó de la lista. ${MILESTONE_ERRORS.tooMany}`,
    );
  });
});

describe("check", () => {
  test("the checkbox and the meter change at once; the server confirms", async () => {
    const user = await renderPage();
    const box = screen.getByRole("checkbox", { name: "Hecho: Luces" });
    await user.click(box);
    expect(box).toBeChecked();
    expect(meter()).toHaveAccessibleName("Avance: 67%, 2 de 3 hitos");
    expect(checkMilestone).toHaveBeenCalledWith({ projectId: PROJECT.id, id: M3, done: true });
    expect(box).toHaveFocus();
    await server.answer();
    expect(box).toBeChecked();
  });

  test("a network failure rolls the box and the meter back, with a notice", async () => {
    const user = await renderPage();
    vi.mocked(checkMilestone).mockRejectedValueOnce(new Error("offline"));
    const box = screen.getByRole("checkbox", { name: "Hecho: Planos" });
    await user.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(meter()).toHaveAccessibleName("Avance: 33%, 1 de 3 hitos");
    expect(notices()).toHaveTextContent(
      "No se pudo marcar el hito; volvió a como estaba. Revisa tu conexión",
    );
  });
});

describe("edit", () => {
  test("the title opens the editor in its row; Enter saves and focus returns to it", async () => {
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: "Editar hito Luces" }));
    const field = screen.getByRole("textbox", { name: "Título" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Luces");
    await user.clear(field);
    await user.type(field, "Luces bajo muebles");
    // jsdom's date inputs don't take typed keys.
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-12-15" } });
    await user.type(field, "{Enter}");
    const button = screen.getByRole("button", { name: "Editar hito Luces bajo muebles" });
    await waitFor(() => expect(button).toHaveFocus());
    expect(button).toHaveAccessibleDescription("Para el 15 dic. 2026");
    expect(updateMilestone).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      id: M3,
      title: "Luces bajo muebles",
      dueDate: "2026-12-15",
    });
    await server.answer();
    await waitFor(() =>
      expect(document.querySelector("[data-detail-announcer]")).toHaveTextContent(
        "Se guardó el hito.",
      ),
    );
  });

  test("Esc cancels with focus back on the title; an empty title is refused", async () => {
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: "Editar hito Planos" }));
    const field = screen.getByRole("textbox", { name: "Título" });
    await user.clear(field);
    await user.type(field, "{Enter}");
    expect(field).toHaveAccessibleDescription(MILESTONE_ERRORS.titleRequired);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar hito Planos" })).toHaveFocus(),
    );
    expect(updateMilestone).not.toHaveBeenCalled();
  });
});

describe("delete and undo", () => {
  test("gone at once, focus to the next row, and Deshacer brings it back in place", async () => {
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: "Editar hito Planos" }));
    await user.click(screen.getByRole("button", { name: "Eliminar hito" }));
    expect(titles()).toEqual(["Muebles", "Luces"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Editar hito Muebles" })).toHaveFocus(),
    );
    expect(meter()).toHaveAccessibleName("Avance: 0%, 0 de 2 hitos");
    expect(notices()).toHaveTextContent("«Planos» se eliminó.");
    await server.answer();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(["Planos", "Muebles", "Luces"]);
    expect(restoreMilestone).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      id: M1,
      title: "Planos",
      dueDate: null,
      doneAt: DONE_AT.toISOString(),
      position: 0,
    });
    await server.answer();
    expect(titles()).toEqual(["Planos", "Muebles", "Luces"]);
    expect(screen.getByRole("checkbox", { name: "Hecho: Planos" })).toBeChecked();
    expect(notices()).toHaveTextContent("«Planos» volvió a su lugar.");
  });

  test("deleting the last one sends focus to the add field; a refusal brings it back", async () => {
    const user = await renderPage({ milestones: [LUCES] });
    await user.click(screen.getByRole("button", { name: "Editar hito Luces" }));
    await user.click(screen.getByRole("button", { name: "Eliminar hito" }));
    await waitFor(() => expect(addField()).toHaveFocus());
    await server.answer(fail(MILESTONE_ERRORS.notFound));
    expect(titles()).toEqual(["Luces"]);
    expect(notices()).toHaveTextContent("No se pudo eliminar el hito; volvió a la lista.");
  });
});

describe("reorder", () => {
  test("Subir/Bajar move at once, keep focus, and share a notice whose Deshacer reverts", async () => {
    const user = await renderPage();
    const down = screen.getByRole("button", { name: "Bajar Planos" });
    await user.click(down);
    expect(titles()).toEqual(["Muebles", "Planos", "Luces"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bajar Planos" })).toHaveFocus());
    expect(notices()).toHaveTextContent("«Planos» pasó al lugar 2 de 3.");
    expect(reorderMilestones).toHaveBeenLastCalledWith({
      projectId: PROJECT.id,
      ids: [M2, M1, M3],
    });
    await user.click(screen.getByRole("button", { name: "Bajar Planos" }));
    expect(titles()).toEqual(["Muebles", "Luces", "Planos"]);
    // At the bottom the key is aria-disabled and does nothing.
    const last = screen.getByRole("button", { name: "Bajar Planos" });
    expect(last).toHaveAttribute("aria-disabled", "true");
    await server.answerAll();

    await user.click(within(notices()).getByRole("button", { name: "Deshacer" }));
    expect(titles()).toEqual(["Planos", "Muebles", "Luces"]);
    await server.answerAll();
    expect(notices()).toHaveTextContent("Volvió el orden anterior de los hitos.");
  });

  test("a stale list is refused: the order goes back and the notice says why", async () => {
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: "Subir Luces" }));
    expect(titles()).toEqual(["Planos", "Luces", "Muebles"]);
    await server.answer(fail(MILESTONE_ERRORS.staleOrder));
    expect(titles()).toEqual(["Planos", "Muebles", "Luces"]);
    expect(notices()).toHaveTextContent(MILESTONE_ERRORS.staleOrder);
  });

  test("the handle drags with the keyboard and says how (dnd-kit)", async () => {
    await renderPage();
    const handle = screen.getByRole("button", { name: "Mover Muebles" });
    expect(handle).toHaveAttribute("aria-roledescription", "elemento ordenable");
    expect(handle).toHaveAccessibleDescription(/pulsa Espacio o Enter/);
  });

  test("with one milestone the handle is aria-disabled", async () => {
    await renderPage({ milestones: [LUCES] });
    expect(screen.getByRole("button", { name: "Mover Luces" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("card", () => {
  test("progress on the card, as the link's description too", () => {
    const html = renderToStaticMarkup(
      <ProjectCard
        project={PROJECT}
        due={null}
        progress={milestoneProgress({ done: 3, total: 5 }, "active")}
      />,
    );
    document.body.innerHTML = html;
    const link = screen.getByRole("link", { name: "Cocina" });
    expect(link).toHaveAccessibleDescription("Avance: 60%, 3 de 5 hitos");
    expect(screen.getByRole("meter")).toHaveAccessibleName("Avance: 60%, 3 de 5 hitos");
    expect(document.querySelectorAll(".bo-segbar__seg.is-filled")).toHaveLength(3);
  });

  test("no progress, no meter and no empty slot", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ProjectCard project={PROJECT} due={null} progress={null} />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("link", { name: "Cocina" })).not.toHaveAttribute("aria-describedby");
  });
});
