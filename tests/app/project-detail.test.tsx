// P2: a project's page (/projects/[id]): sections, in-place edits (optimistic, with the server as
// the source of truth), due notice per state, and delete with a confirm step.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectCloseSection } from "@/app/(app)/projects/[id]/_components/project-close-section";
import { ProjectDeleteSection } from "@/app/(app)/projects/[id]/_components/project-delete-section";
import { ProjectDetailProvider } from "@/app/(app)/projects/[id]/_components/project-detail-context";
import { ProjectHeader } from "@/app/(app)/projects/[id]/_components/project-header";
import { ProjectPlanSection } from "@/app/(app)/projects/[id]/_components/project-plan-section";
import {
  ProjectStateSection,
  STATUS_SETTLE_MS,
} from "@/app/(app)/projects/[id]/_components/project-state-section";
import ProjectNotFound from "@/app/(app)/projects/[id]/not-found";
import ProjectPage, { generateMetadata } from "@/app/(app)/projects/[id]/page";
import { fail, ok, UNEXPECTED_ERROR_MESSAGE, type ActionResult } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import {
  changeProjectArea,
  changeProjectPriority,
  changeProjectStatus,
  deleteProject,
  renameProject,
  updateProjectDates,
  updateProjectObjective,
} from "@/modules/projects/actions";
import {
  PROJECT_ERRORS,
  type ProjectAreaSummary,
  type ProjectDetail,
} from "@/modules/projects/project-input";
import { closeProject, reopenProject } from "@/modules/projects/close-actions";
import type { MilestoneCounts } from "@/modules/projects/milestone-input";
import type { OpenWork } from "@/modules/projects/project-close";
import { completedAtAfter } from "@/modules/projects/project-status";
import type { ProgressCounts } from "@/modules/projects/progress-source";
import { getProject } from "@/modules/projects/queries";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/modules/core/queries", () => ({ listLifeAreas: vi.fn() }));
vi.mock("@/modules/projects/queries", () => ({
  getProject: vi.fn(),
  // P4: no blockers and nothing to add unless a test says so.
  getProjectDependencies: vi.fn(async () => ({ blockers: [], blocking: [], candidates: [] })),
}));
// P3: milestones (none here; their own tests are in project-milestones.test.tsx).
vi.mock("@/modules/projects/milestone-queries", () => ({
  getProjectMilestones: vi.fn(async () => []),
  listMilestoneCounts: vi.fn(async () => ({})),
}));
// P5: links and notes (their own tests: tests/app/project-notes-links.test.tsx).
vi.mock("@/modules/projects/link-queries", () => ({ listProjectLinks: vi.fn(async () => []) }));
vi.mock("@/modules/projects/link-actions", () => ({}));
vi.mock("@/modules/projects/notes-actions", () => ({}));
vi.mock("@/modules/projects/actions", () => ({
  renameProject: vi.fn(),
  changeProjectStatus: vi.fn(),
  changeProjectPriority: vi.fn(),
  changeProjectArea: vi.fn(),
  updateProjectObjective: vi.fn(),
  updateProjectDates: vi.fn(),
  deleteProject: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
}));
// Checkpoint final: "Cerrar proyecto".
vi.mock("@/modules/projects/close-actions", () => ({
  closeProject: vi.fn(),
  reopenProject: vi.fn(),
}));

const HOME: ProjectAreaSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  color: "home",
  icon: "house",
};
const WORK: ProjectAreaSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "work",
  name: "Trabajo",
  color: "work",
  icon: "briefcase",
};
const OLD: ProjectAreaSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "old",
  name: "Antigua",
  color: "travel",
  icon: "star",
};
const AREAS = [HOME, WORK];

// 10:00 in Lima on Oct 1, 2026: "today" for the due notices.
const NOW = new Date("2026-10-01T15:00:00.000Z");

const PROJECT: ProjectDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Mudanza",
  objective: "Todo en el depa nuevo antes de fin de mes.",
  status: "active",
  priority: "high",
  startDate: "2026-09-20",
  dueDate: "2026-10-04",
  completedAt: null,
  area: HOME,
  notes: null,
};

/**
 * A fake server: each action call waits until the test answers it (in order), then applies the
 * change and re-renders the page with it, like the action's revalidation. Every call must settle
 * before the test ends: React entangles pending async transitions.
 */
const server = {
  project: PROJECT,
  /** What closeProject's own count says was left open. */
  open: { milestones: 0, tasks: 0 } as OpenWork,
  render: (() => {}) as (project: ProjectDetail) => void,
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

function serverCall<T = ProjectDetail>(
  apply: (project: ProjectDetail) => ProjectDetail,
  value: (project: ProjectDetail) => T = (project) => project as T,
): Promise<ActionResult<T>> {
  return new Promise((resolve) => {
    server.pending.push({
      answer: (result) => {
        if (!result || result.ok) {
          server.project = apply(server.project);
          server.render(server.project);
        }
        resolve((result ?? ok(value(server.project))) as ActionResult<T>);
      },
    });
  });
}

/** The page's milestones and what the progress sources count, for "Cerrar proyecto". */
const work = {
  counts: { done: 0, total: 0 } as MilestoneCounts,
  contributed: undefined as ProgressCounts | undefined,
};

function Detail({ initial, areas }: { initial: ProjectDetail; areas: ProjectAreaSummary[] }) {
  const [project, setProject] = useState(initial);
  useLayoutEffect(() => {
    server.render = setProject;
  }, []);
  return (
    <ProjectDetailProvider project={project} now={NOW}>
      <ProjectHeader headingId="project-title" areas={areas} />
      <ProjectStateSection />
      <ProjectPlanSection />
      <ProjectCloseSection counts={work.counts} contributed={work.contributed} />
      <ProjectDeleteSection />
    </ProjectDetailProvider>
  );
}

function renderDetail(values: Partial<ProjectDetail> = {}, areas = AREAS) {
  server.project = { ...PROJECT, ...values };
  render(<Detail initial={server.project} areas={areas} />);
  return userEvent.setup();
}

type Input = Record<string, unknown>;

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  server.pending = [];
  server.open = { milestones: 0, tasks: 0 };
  work.counts = { done: 0, total: 0 };
  work.contributed = undefined;
  router.replace.mockReset();
  vi.mocked(closeProject)
    .mockReset()
    .mockImplementation((input) => {
      const status = (input as Input).status as "done" | "canceled";
      return serverCall(
        (p) => ({ ...p, status, completedAt: completedAtAfter(status, p.completedAt, NOW) }),
        (project) => ({ project, open: server.open }),
      );
    });
  vi.mocked(reopenProject)
    .mockReset()
    .mockImplementation(() =>
      serverCall((p) => ({ ...p, status: "active" as const, completedAt: null })),
    );
  vi.mocked(renameProject)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => ({ ...p, name: (input as Input).name as string })),
    );
  vi.mocked(changeProjectStatus)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => {
        const status = (input as Input).status as ProjectDetail["status"];
        return { ...p, status, completedAt: completedAtAfter(status, p.completedAt, NOW) };
      }),
    );
  vi.mocked(changeProjectPriority)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => ({
        ...p,
        priority: (input as Input).priority as ProjectDetail["priority"],
      })),
    );
  vi.mocked(changeProjectArea)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => ({
        ...p,
        area: [...AREAS, OLD].find((area) => area.id === (input as Input).lifeAreaId)!,
      })),
    );
  vi.mocked(updateProjectObjective)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => ({ ...p, objective: (input as Input).objective as string | null })),
    );
  vi.mocked(updateProjectDates)
    .mockReset()
    .mockImplementation((input) =>
      serverCall((p) => ({
        ...p,
        startDate: (input as Input).startDate as string | null,
        dueDate: (input as Input).dueDate as string | null,
      })),
    );
  vi.mocked(deleteProject).mockReset();
});

afterEach(async () => {
  await server.answerAll();
});

const heading = () => screen.getByRole("heading", { level: 1 });
const statusGroup = () => screen.getByRole("radiogroup", { name: "Estado" });
const priorityGroup = () => screen.getByRole("radiogroup", { name: "Prioridad" });
const notices = () => screen.getByRole("region", { name: "Avisos" });
const announcer = () => document.querySelector("[data-detail-announcer]")!;

describe("page", () => {
  const params = (id: string, search: Record<string, string> = {}) => ({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(search),
  });

  beforeEach(() => {
    vi.mocked(requireOwner)
      .mockReset()
      .mockResolvedValue({ user: { id: "owner" } } as never);
    vi.mocked(listLifeAreas)
      .mockReset()
      .mockResolvedValue(AREAS.map((area, sortOrder) => ({ ...area, sortOrder })));
    vi.mocked(getProject).mockReset().mockResolvedValue(PROJECT);
  });

  test("checks the owner and lays out header, Estado, Objetivo y fechas and Eliminar", async () => {
    render(await ProjectPage(params(PROJECT.id)));
    expect(requireOwner).toHaveBeenCalled();
    expect(heading()).toHaveTextContent("Mudanza");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Estado y prioridad",
      "Objetivo y fechas",
      "Hitos",
      "Bloqueado por",
      "Enlaces",
      "Notas",
      "Cerrar proyecto",
    ]);
    expect(screen.getByText("Hogar")).toBeInTheDocument();
    expect(within(statusGroup()).getByRole("radio", { name: "Activo" })).toBeChecked();
    expect(within(priorityGroup()).getByRole("radio", { name: "Alta" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Eliminar proyecto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(await generateMetadata(params(PROJECT.id))).toEqual({ title: "Mudanza · brahua-os" });
  });

  test("right after creating: focus on the heading, announced, and the URL cleaned", async () => {
    window.history.replaceState(null, "", `/projects/${PROJECT.id}?created=1`);
    render(await ProjectPage(params(PROJECT.id, { created: "1" })));
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(window.location.search).toBe("");
    await waitFor(() =>
      expect(document.querySelector("[data-created-notice]")).toHaveTextContent(
        "Proyecto «Mudanza» creado.",
      ),
    );
  });

  test("opened any other way, nothing is announced and focus stays put", async () => {
    render(await ProjectPage(params(PROJECT.id)));
    expect(document.querySelector("[data-created-notice]")).toBeNull();
    expect(heading()).not.toHaveFocus();
  });

  test("a missing or deleted project is a 404", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    await expect(ProjectPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(params("nope"))).toEqual({
      title: "Proyecto no encontrado · brahua-os",
      robots: { index: false, follow: false },
    });
  });

  test("its 404 page leads back to the list", () => {
    render(<ProjectNotFound />);
    expect(heading()).toHaveTextContent("Este proyecto no está");
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });
});

describe("name", () => {
  test("edit in place: Enter saves, the heading changes at once, focus back on the pencil", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    const field = screen.getByRole("textbox", { name: "Nombre" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Mudanza");
    // The page keeps its h1 while editing.
    expect(heading()).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "  Mudanza   a Miraflores {Enter}");
    expect(heading()).toHaveTextContent("Mudanza a Miraflores");
    expect(renameProject).toHaveBeenCalledWith({ id: PROJECT.id, name: "Mudanza a Miraflores" });
    expect(screen.getByRole("button", { name: "Editar nombre" })).toHaveFocus();

    expect(announcer()).toBeEmptyDOMElement();
    await server.answer();
    expect(heading()).toHaveTextContent("Mudanza a Miraflores");
    // Saved: said politely once the server agreed.
    await waitFor(() => expect(announcer()).toHaveTextContent("Se guardó el nombre."));
  });

  test("invalid: the error shows on the field, is announced, and nothing is sent", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    const field = screen.getByRole("textbox", { name: "Nombre" });
    const form = screen.getByRole("form", { name: "Editar nombre" });
    expect(within(form).getByRole("status")).toBeEmptyDOMElement();
    await user.clear(field);
    // Enter keeps focus on the field, so only the live region says what went wrong.
    await user.keyboard("{Enter}");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(PROJECT_ERRORS.nameRequired);
    expect(field).toHaveFocus();
    expect(within(form).getByRole("status")).toHaveTextContent(PROJECT_ERRORS.nameRequired);
    expect(renameProject).not.toHaveBeenCalled();
  });

  test("Esc cancels without saving and focus goes back to the pencil", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    await user.type(screen.getByRole("textbox", { name: "Nombre" }), "xx");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Nombre" })).not.toBeInTheDocument();
    expect(heading()).toHaveTextContent("Mudanza");
    expect(screen.getByRole("button", { name: "Editar nombre" })).toHaveFocus();
    expect(renameProject).not.toHaveBeenCalled();
  });

  test("a refusal rolls back and a notice says why", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar nombre" }));
    const field = screen.getByRole("textbox", { name: "Nombre" });
    await user.clear(field);
    await user.type(field, "Otro nombre{Enter}");
    expect(heading()).toHaveTextContent("Otro nombre");
    await server.answer(fail(UNEXPECTED_ERROR_MESSAGE));
    expect(heading()).toHaveTextContent("Mudanza");
    expect(notices()).toHaveTextContent("Sin guardar");
    // Always which edit failed and that it rolled back, then the server's reason.
    expect(notices()).toHaveTextContent(
      `No se pudo guardar el nombre; volvió a como estaba. ${UNEXPECTED_ERROR_MESSAGE}`,
    );
    expect(announcer()).toBeEmptyDOMElement();
  });
});

describe("status", () => {
  test("the four open states; Terminado and Cancelado are “Cerrar proyecto”", async () => {
    const user = renderDetail();
    const radios = within(statusGroup()).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Idea",
      "Activo",
      "Pausado",
      "Mantenimiento",
    ]);
    expect(screen.getByText("Vence en 3 días")).toBeInTheDocument();

    await user.click(within(statusGroup()).getByRole("radio", { name: "Pausado" }));
    expect(within(statusGroup()).getByRole("radio", { name: "Pausado" })).toBeChecked();
    expect(changeProjectStatus).toHaveBeenCalledWith({ id: PROJECT.id, status: "paused" });
    await server.answer();
    expect(server.project).toMatchObject({ status: "paused", completedAt: null });
  });

  test("a closed project shows its state as text instead of the picker", () => {
    renderDetail({ status: "canceled" });
    expect(screen.queryByRole("radiogroup", { name: "Estado" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-closed-status]")).toHaveTextContent(
      "Cancelado. Para cambiar el estado, reábrelo en «Cerrar proyecto», más abajo.",
    );
    // The priority can still change.
    expect(priorityGroup()).toBeInTheDocument();
  });

  test("arrows show each state at once but save only where they rest", async () => {
    const user = renderDetail({ status: "idea" });
    within(statusGroup()).getByRole("radio", { name: "Idea" }).focus();
    // Idea → Activo → Pausado → Mantenimiento.
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(within(statusGroup()).getByRole("radio", { name: "Mantenimiento" })).toBeChecked();
    expect(within(statusGroup()).getByRole("radio", { name: "Mantenimiento" })).toHaveFocus();
    expect(changeProjectStatus).not.toHaveBeenCalled();

    await waitFor(() => expect(changeProjectStatus).toHaveBeenCalledTimes(1), {
      timeout: STATUS_SETTLE_MS * 3,
    });
    expect(changeProjectStatus).toHaveBeenCalledWith({ id: PROJECT.id, status: "maintenance" });
    await server.answer();
    expect(server.project).toMatchObject({ status: "maintenance", completedAt: null });
  });

  test("Tab away from a resting pick saves it right away", async () => {
    const user = renderDetail({ status: "active" });
    within(statusGroup()).getByRole("radio", { name: "Activo" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(changeProjectStatus).not.toHaveBeenCalled();
    await user.tab();
    expect(changeProjectStatus).toHaveBeenCalledWith({ id: PROJECT.id, status: "paused" });
  });

  test("quick clicks: the one in flight, then only the last; the screen keeps the last", async () => {
    const user = renderDetail({ status: "idea" });
    await user.click(within(statusGroup()).getByRole("radio", { name: "Activo" }));
    await user.click(within(statusGroup()).getByRole("radio", { name: "Pausado" }));
    await user.click(within(statusGroup()).getByRole("radio", { name: "Mantenimiento" }));
    expect(changeProjectStatus).toHaveBeenCalledTimes(1);
    expect(changeProjectStatus).toHaveBeenLastCalledWith({ id: PROJECT.id, status: "active" });

    await server.answer();
    // The server's answer for Activo doesn't pull the screen back while Mantenimiento is pending.
    expect(within(statusGroup()).getByRole("radio", { name: "Mantenimiento" })).toBeChecked();
    await waitFor(() => expect(changeProjectStatus).toHaveBeenCalledTimes(2));
    expect(changeProjectStatus).toHaveBeenLastCalledWith({
      id: PROJECT.id,
      status: "maintenance",
    });
    await server.answer();
    expect(server.project.status).toBe("maintenance");
    expect(within(statusGroup()).getByRole("radio", { name: "Mantenimiento" })).toBeChecked();
  });

  test("the save in flight fails while a newer one waits: no notice, the newer one wins", async () => {
    const user = renderDetail({ status: "active" });
    await user.click(within(statusGroup()).getByRole("radio", { name: "Pausado" }));
    await user.click(within(statusGroup()).getByRole("radio", { name: "Idea" }));
    await server.answer(fail(UNEXPECTED_ERROR_MESSAGE));
    expect(within(statusGroup()).getByRole("radio", { name: "Idea" })).toBeChecked();
    await waitFor(() => expect(changeProjectStatus).toHaveBeenCalledTimes(2));
    await server.answer();
    expect(server.project.status).toBe("idea");
    expect(within(statusGroup()).getByRole("radio", { name: "Idea" })).toBeChecked();
    expect(notices()).not.toHaveTextContent("Sin guardar");
  });

  test("a network failure rolls back with a notice", async () => {
    const user = renderDetail();
    vi.mocked(changeProjectStatus).mockRejectedValueOnce(new Error("offline"));
    await user.click(within(statusGroup()).getByRole("radio", { name: "Pausado" }));
    await waitFor(() =>
      expect(notices()).toHaveTextContent(
        "No se pudo guardar el estado; volvió a como estaba. Revisa tu conexión e inténtalo de nuevo.",
      ),
    );
    expect(within(statusGroup()).getByRole("radio", { name: "Activo" })).toBeChecked();
  });

  test("due notice per state: only idea, active and paused; maintenance hides the end date", async () => {
    const user = renderDetail({ dueDate: "2026-10-01" });
    expect(screen.getByText("Vence hoy").closest("p")).toHaveClass("text-signal-text");
    for (const [state, visible] of [
      ["Idea", true],
      ["Pausado", true],
      ["Mantenimiento", false],
    ] as const) {
      await user.click(within(statusGroup()).getByRole("radio", { name: state }));
      if (visible) expect(screen.getByText("Vence hoy")).toBeInTheDocument();
      else expect(screen.queryByText("Vence hoy")).not.toBeInTheDocument();
      if (state === "Mantenimiento") {
        expect(screen.getByText("En Mantenimiento no hay fecha de fin.")).toBeInTheDocument();
        expect(screen.queryByText("Fin")).not.toBeInTheDocument();
      }
      await server.answerAll();
    }
  });

  test.each(["done", "canceled"] as const)("no due notice once %s", (status) => {
    renderDetail({
      status,
      dueDate: "2026-10-01",
      completedAt: status === "done" ? NOW : null,
    });
    expect(screen.queryByText("Vence hoy")).not.toBeInTheDocument();
  });
});

describe("close", () => {
  const markDone = () => screen.getByRole("button", { name: "Marcar como terminado" });
  const step = (name: string | RegExp) => screen.getByRole("group", { name });

  test("Marcar como terminado: a confirm step that warns about open milestones, then Historial", async () => {
    work.counts = { done: 1, total: 3 };
    server.open = { milestones: 2, tasks: 0 };
    const user = renderDetail();
    await user.click(markDone());
    const confirm = step("¿Marcar «Mudanza» como terminado?");
    expect(within(confirm).getByRole("button", { name: "Volver" })).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(
      "Quedan 2 hitos abiertos. ¿Terminar igual? Sale de la vista principal y queda en el Historial con la fecha de hoy.",
    );

    await user.click(within(confirm).getByRole("button", { name: "Sí, terminar" }));
    expect(closeProject).toHaveBeenCalledWith({ id: PROJECT.id, status: "done" });
    // Waiting for the server: aria-disabled (never disabled), and said.
    const busyKey = within(confirm).getByRole("button", { name: "Terminando…" });
    expect(busyKey).toHaveAttribute("aria-disabled", "true");
    expect(busyKey).toBeEnabled();
    expect(within(confirm).getByRole("button", { name: "Volver" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(confirm).getByRole("status")).toHaveTextContent("Terminando…");
    // Clicking again while it waits sends nothing more.
    await user.click(busyKey);
    expect(closeProject).toHaveBeenCalledTimes(1);

    await server.answer();
    expect(server.project).toMatchObject({ status: "done", completedAt: NOW });
    expect(document.querySelector("[data-closed-state]")).toHaveTextContent(
      "Se terminó el 1 de octubre de 2026.",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Reabrir" })).toHaveFocus());
    await waitFor(() =>
      expect(announcer()).toHaveTextContent(
        "«Mudanza» se marcó como terminado. Quedaron 2 hitos abiertos.",
      ),
    );
    expect(screen.getByText("Terminado el 1 de octubre de 2026")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Estado" })).not.toBeInTheDocument();
  });

  test("the warning counts the live milestones and the progress sources' open units", async () => {
    work.counts = { done: 2, total: 3 };
    work.contributed = { done: 1, total: 4 };
    const user = renderDetail();
    await user.click(markDone());
    expect(document.querySelector("[data-open-work-warning]")).toHaveTextContent(
      "Quedan 1 hito abierto y 3 tareas abiertas. ¿Terminar igual?",
    );
  });

  test("one open milestone: singular", async () => {
    work.counts = { done: 2, total: 3 };
    const user = renderDetail();
    await user.click(markDone());
    expect(document.querySelector("[data-open-work-warning]")).toHaveTextContent(
      "Queda 1 hito abierto. ¿Terminar igual?",
    );
  });

  test("nothing open: no warning", async () => {
    work.counts = { done: 3, total: 3 };
    const user = renderDetail();
    await user.click(markDone());
    expect(step(/como terminado/)).toBeInTheDocument();
    expect(document.querySelector("[data-open-work-warning]")).toBeNull();
  });

  test("Esc or Volver go back with focus on the key that opened the step", async () => {
    const user = renderDetail();
    await user.click(markDone());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /como terminado/ })).not.toBeInTheDocument();
    expect(markDone()).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancelar proyecto" }));
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("button", { name: "Cancelar proyecto" })).toHaveFocus();
    expect(closeProject).not.toHaveBeenCalled();
  });

  test("Cancelar proyecto: a simple confirm step, then Cancelado without a date", async () => {
    work.counts = { done: 0, total: 2 };
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Cancelar proyecto" }));
    const confirm = step("¿Cancelar «Mudanza»?");
    // Open milestones don't matter when canceling.
    expect(document.querySelector("[data-open-work-warning]")).toBeNull();
    await user.click(within(confirm).getByRole("button", { name: "Sí, cancelar proyecto" }));
    expect(closeProject).toHaveBeenCalledWith({ id: PROJECT.id, status: "canceled" });
    await server.answer();
    expect(server.project).toMatchObject({ status: "canceled", completedAt: null });
    expect(document.querySelector("[data-closed-state]")).toHaveTextContent("Se canceló.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reabrir" })).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("«Mudanza» se canceló."));
  });

  test("Reabrir: back to Activo with a confirm step; the finish date goes", async () => {
    const user = renderDetail({ status: "done", completedAt: NOW });
    expect(screen.queryByRole("button", { name: "Marcar como terminado" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reabrir" }));
    const confirm = step("¿Reabrir «Mudanza»?");
    expect(confirm).toHaveAccessibleDescription(/se borra la fecha de término/);
    expect(within(confirm).getByRole("button", { name: "Volver" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Sí, reabrir" }));
    expect(reopenProject).toHaveBeenCalledWith({ id: PROJECT.id });
    await server.answer();
    expect(server.project).toMatchObject({ status: "active", completedAt: null });
    await waitFor(() => expect(markDone()).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("«Mudanza» se reabrió como Activo."));
    expect(within(statusGroup()).getByRole("radio", { name: "Activo" })).toBeChecked();
    expect(screen.queryByText(/^Terminado el /)).not.toBeInTheDocument();
  });

  test("a failure shows in the confirm step and nothing changes", async () => {
    const user = renderDetail();
    await user.click(markDone());
    await user.click(screen.getByRole("button", { name: "Sí, terminar" }));
    await server.answer(fail(PROJECT_ERRORS.notFound));
    expect(await screen.findByRole("alert")).toHaveTextContent(PROJECT_ERRORS.notFound);
    expect(step(/como terminado/)).toBeInTheDocument();
    expect(server.project.status).toBe("active");
  });

  test("a network failure says so in the confirm step", async () => {
    vi.mocked(closeProject).mockRejectedValueOnce(new Error("offline"));
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Cancelar proyecto" }));
    await user.click(screen.getByRole("button", { name: "Sí, cancelar proyecto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.",
    );
  });
});

describe("priority", () => {
  test("Baja, Media, Alta; saved at once", async () => {
    const user = renderDetail();
    await user.click(within(priorityGroup()).getByRole("radio", { name: "Baja" }));
    expect(within(priorityGroup()).getByRole("radio", { name: "Baja" })).toBeChecked();
    expect(changeProjectPriority).toHaveBeenCalledWith({ id: PROJECT.id, priority: "low" });
    // The same value again sends nothing.
    await user.click(within(priorityGroup()).getByRole("radio", { name: "Baja" }));
    expect(changeProjectPriority).toHaveBeenCalledTimes(1);
  });

  test("each option has its LED (hidden from screen readers; the label names it)", () => {
    renderDetail();
    for (const [name, priority] of [
      ["Baja", "low"],
      ["Media", "medium"],
      ["Alta", "high"],
    ] as const) {
      const option = within(priorityGroup()).getByRole("radio", { name });
      const led = option.querySelector(`[data-priority-led="${priority}"]`);
      expect(led).toHaveAttribute("aria-hidden", "true");
      expect(led).toHaveClass(`bo-priority-led--${priority}`);
    }
    // Alta is the signal LED, like the card's.
    expect(priorityGroup().querySelector('[data-priority-led="high"]')).toHaveClass(
      "bo-led--signal",
    );
    expect(priorityGroup().querySelector('[data-priority-led="medium"]')).not.toHaveClass(
      "bo-led--signal",
    );
  });
});

describe("area", () => {
  test("the pencil names the area it changes (name and tooltip)", () => {
    renderDetail();
    const pencil = screen.getByRole("button", { name: "Cambiar área (Hogar)" });
    // The tooltip is the key's sibling, hidden from screen readers (the name already says it).
    expect(pencil.parentElement).toHaveTextContent("Cambiar área (Hogar)");
  });

  test("without active areas: the reason and only Cancelar", async () => {
    const user = renderDetail({ area: OLD }, []);
    await user.click(screen.getByRole("button", { name: "Cambiar área (Antigua)" }));
    const form = screen.getByRole("form", { name: "Cambiar área" });
    expect(form).toHaveTextContent("No tienes otras áreas activas.");
    expect(
      within(form)
        .getAllByRole("button")
        .map((key) => key.textContent),
    ).toEqual(["Cancelar"]);
    await user.click(within(form).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Cambiar área (Antigua)" })).toHaveFocus();
  });

  test("offers the active areas; the pick shows at once", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: /^Cambiar área/ }));
    const group = screen.getByRole("radiogroup", { name: "Área" });
    expect(within(group).getByRole("radio", { name: "Hogar" })).toHaveFocus();
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Hogar", "Trabajo"]);
    await user.click(within(group).getByRole("radio", { name: "Trabajo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Trabajo")).toBeInTheDocument();
    expect(changeProjectArea).toHaveBeenCalledWith({ id: PROJECT.id, lifeAreaId: WORK.id });
    expect(screen.getByRole("button", { name: /^Cambiar área/ })).toHaveFocus();
  });

  test("an archived area stays until another is picked (none comes picked)", async () => {
    const user = renderDetail({ area: OLD });
    expect(screen.getByText("Antigua")).toBeInTheDocument();
    expect(screen.getByText("(archivada)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Cambiar área/ }));
    const group = screen.getByRole("radiogroup", { name: "Área" });
    expect(within(group).queryByRole("radio", { checked: true })).toBeNull();
    expect(within(group).queryByRole("radio", { name: "Antigua" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(group).toHaveAccessibleDescription(/Elige un área\./);
    expect(changeProjectArea).not.toHaveBeenCalled();
  });

  test("an area archived meanwhile: the server's message, and it rolls back", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: /^Cambiar área/ }));
    await user.click(screen.getByRole("radio", { name: "Trabajo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await server.answer({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    });
    expect(notices()).toHaveTextContent(PROJECT_ERRORS.areaUnavailable);
    expect(screen.getByText("Hogar")).toBeInTheDocument();
  });
});

describe("objective", () => {
  test("edit, validated (≤ 280), and emptied clears it", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar objetivo" }));
    const field = screen.getByRole("textbox", { name: "Objetivo" });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(281));
    await user.keyboard("{Enter}");
    expect(field).toHaveAccessibleDescription(PROJECT_ERRORS.objectiveTooLong);
    expect(updateProjectObjective).not.toHaveBeenCalled();

    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(screen.getByText("Sin objetivo.")).toBeInTheDocument();
    expect(updateProjectObjective).toHaveBeenCalledWith({ id: PROJECT.id, objective: null });
    expect(screen.getByRole("button", { name: "Editar objetivo" })).toHaveFocus();
  });
});

describe("dates", () => {
  test("shows both days; the end before the start is an error on the end", async () => {
    const user = renderDetail();
    expect(screen.getByText("20 de setiembre de 2026")).toBeInTheDocument();
    expect(screen.getByText("4 de octubre de 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar fechas" }));
    const start = screen.getByLabelText("Inicio");
    const due = screen.getByLabelText("Fin");
    expect(start).toHaveFocus();
    await user.clear(due);
    await user.type(due, "2026-09-10");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(due).toHaveAttribute("aria-invalid", "true");
    expect(due).toHaveAccessibleDescription(PROJECT_ERRORS.dueBeforeStart);
    expect(due).toHaveFocus();
    expect(updateProjectDates).not.toHaveBeenCalled();

    // Moving the start fixes it.
    await user.clear(start);
    await user.type(start, "2026-09-01");
    expect(due).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(updateProjectDates).toHaveBeenCalledWith({
      id: PROJECT.id,
      startDate: "2026-09-01",
      dueDate: "2026-09-10",
    });
    expect(screen.getByText("Vencido hace 21 días")).toBeInTheDocument();
  });

  test("both empty: “Sin fechas.”", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Editar fechas" }));
    await user.clear(screen.getByLabelText("Inicio"));
    await user.clear(screen.getByLabelText("Fin"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Sin fechas.")).toBeInTheDocument();
    expect(updateProjectDates).toHaveBeenCalledWith({
      id: PROJECT.id,
      startDate: null,
      dueDate: null,
    });
  });

  test("maintenance: no end field; the saved end is kept and bounds the start", async () => {
    const user = renderDetail({ status: "maintenance" });
    await user.click(screen.getByRole("button", { name: "Editar fechas" }));
    expect(screen.queryByLabelText("Fin")).not.toBeInTheDocument();
    const start = screen.getByLabelText("Inicio");
    await user.clear(start);
    await user.type(start, "2026-10-10");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(start).toHaveAccessibleDescription(
      "El inicio no puede ser posterior a la fecha de fin guardada (4 oct. 2026).",
    );
    await user.clear(start);
    await user.type(start, "2026-09-25");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(updateProjectDates).toHaveBeenCalledWith({
      id: PROJECT.id,
      startDate: "2026-09-25",
      dueDate: "2026-10-04",
    });
  });
});

describe("delete", () => {
  test("a confirm step on the page; Esc or Cancelar goes back with focus on the key", async () => {
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Eliminar proyecto" }));
    const confirm = screen.getByRole("group", { name: "¿Eliminar «Mudanza»?" });
    expect(within(confirm).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar proyecto" })).toHaveFocus();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  test("confirmed: deletes and goes back to the list with ?deleted=<id>", async () => {
    vi.mocked(deleteProject).mockResolvedValue(ok({ id: PROJECT.id, name: PROJECT.name }));
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Eliminar proyecto" }));
    await user.click(screen.getByRole("button", { name: "Sí, eliminar" }));
    expect(deleteProject).toHaveBeenCalledWith({ id: PROJECT.id });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/projects?deleted=${PROJECT.id}`),
    );
  });

  test("a failure shows in the confirm step and nothing navigates", async () => {
    vi.mocked(deleteProject).mockResolvedValue(fail(PROJECT_ERRORS.notFound));
    const user = renderDetail();
    await user.click(screen.getByRole("button", { name: "Eliminar proyecto" }));
    await user.click(screen.getByRole("button", { name: "Sí, eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PROJECT_ERRORS.notFound);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
