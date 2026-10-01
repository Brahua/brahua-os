import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectSheet } from "@/app/(app)/projects/_components/project-sheet";
import ProjectsPage, { metadata } from "@/app/(app)/projects/page";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";
import { createProject, restoreProject } from "@/modules/projects/actions";
import { ProjectCard } from "@/modules/projects/components/project-card";
import { PROJECT_ERRORS, type ProjectSummary } from "@/modules/projects/project-input";
import { getDeletedProject, getProject, listProjects } from "@/modules/projects/queries";

const router = vi.hoisted(() => ({ push: vi.fn() }));
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
  listProjects: vi.fn(),
  getProject: vi.fn(),
  getDeletedProject: vi.fn(),
}));
vi.mock("@/modules/projects/actions", () => ({ createProject: vi.fn(), restoreProject: vi.fn() }));

const HOME: LifeAreaSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "home",
  name: "Hogar",
  color: "home",
  icon: "house",
  sortOrder: 0,
};
const WORK: LifeAreaSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "work",
  name: "Trabajo",
  color: "work",
  icon: "briefcase",
  sortOrder: 1,
};
const area = ({ id, slug, name, icon, color }: LifeAreaSummary) => ({
  id,
  slug,
  name,
  icon,
  color,
});

let serial = 0;
function project(values: Partial<ProjectSummary>): ProjectSummary {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Proyecto ${serial}`,
    objective: null,
    status: "active",
    priority: "medium",
    startDate: null,
    dueDate: null,
    completedAt: null,
    area: area(HOME),
    ...values,
  };
}

// 10:00 in Lima on Oct 1, 2026.
const NOW = new Date("2026-10-01T15:00:00.000Z");

const PROJECTS = [
  project({ name: "Mudanza", status: "active", priority: "high", dueDate: "2026-10-01" }),
  project({ name: "Web personal", status: "maintenance", dueDate: "2026-09-01", area: area(WORK) }),
  project({ name: "Curso AWS", status: "active", dueDate: "2026-10-04", area: area(WORK) }),
  project({ name: "Huerto", status: "idea" }),
  project({ name: "Pintar sala", status: "paused", dueDate: "2026-09-29" }),
  project({ name: "Viaje a Cusco", status: "done" }),
  project({ name: "Tesis", status: "canceled", area: area(WORK) }),
];

const page = (search: Record<string, string | string[]> = {}) =>
  ProjectsPage({ searchParams: Promise.resolve(search) });

let desktop = false;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  desktop = false;
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(requireOwner)
    .mockReset()
    .mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(listLifeAreas).mockReset().mockResolvedValue([HOME, WORK]);
  vi.mocked(listProjects).mockReset().mockResolvedValue(PROJECTS);
  vi.mocked(getProject).mockReset();
  vi.mocked(getDeletedProject).mockReset();
  vi.mocked(restoreProject).mockReset();
  vi.mocked(createProject).mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The headings of a level have exactly these accessible names, in order. */
function expectHeadings(level: 2 | 3, names: string[]) {
  const found = screen.getAllByRole("heading", { level });
  expect(found).toHaveLength(names.length);
  found.forEach((heading, index) => expect(heading).toHaveAccessibleName(names[index]));
}
const cardsIn = (status: string) =>
  within(screen.getByRole("list", { name: `Proyectos: ${status}` }))
    .getAllByRole("link")
    .map((link) => link.textContent);
const filterTrigger = () => screen.getByRole("button", { name: /^Filtrar por área/ });
/** Opens the area filter and returns its option links. */
async function openFilter() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(filterTrigger());
  const dialog = await screen.findByRole("dialog", { name: "Filtrar por área" });
  return (name: string | RegExp) => within(dialog).getByRole("link", { name });
}

describe("list", () => {
  test("has its title and checks the owner", async () => {
    expect(metadata.title).toBe("Proyectos · brahua-os");
    render(await page());
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Proyectos" })).toBeInTheDocument();
  });

  test("groups by state in order (Activo, Mantenimiento, Pausado, Idea) and sorts inside", async () => {
    render(await page());
    // The count is said in words ("2 proyectos"), not as a bare number.
    expectHeadings(2, [
      "Activo, 2 proyectos",
      "Mantenimiento, 1 proyecto",
      "Pausado, 1 proyecto",
      "Idea, 1 proyecto",
      "Historial, 2 proyectos",
    ]);
    // High priority first, whatever the dates.
    expect(cardsIn("Activo")).toEqual(["Mudanza", "Curso AWS"]);
  });

  test("Historial is folded with its count, and opens to Terminado and Cancelado", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(await page());
    const toggle = screen.getByRole("button", { name: /^Historial/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleName("Historial, 2 proyectos");
    expect(screen.queryByRole("link", { name: "Viaje a Cusco" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Terminado, 1 proyecto", "Cancelado, 1 proyecto"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeVisible();
    }
    expect(cardsIn("Terminado")).toEqual(["Viaje a Cusco"]);
    expect(cardsIn("Cancelado")).toEqual(["Tesis"]);
  });

  test("cards: area, link to the detail, due notice in Lima time, only Alta highlighted", async () => {
    render(await page());
    const move = screen.getByRole("link", { name: "Mudanza" });
    expect(move).toHaveAttribute("href", `/projects/${PROJECTS[0].id}`);
    const card = move.closest("article")!;
    expect(within(card).getByText("Hogar")).toBeInTheDocument();
    expect(within(card).getByText("Vence hoy")).toHaveAttribute("datetime", "2026-10-01");
    expect(within(card).getByText("Prioridad alta")).toBeInTheDocument();

    const aws = screen.getByRole("link", { name: "Curso AWS" }).closest("article")!;
    expect(within(aws).getByText("Vence en 3 días")).toBeInTheDocument();
    expect(within(aws).queryByText("Prioridad alta")).not.toBeInTheDocument();

    const paused = screen.getByRole("link", { name: "Pintar sala" }).closest("article")!;
    expect(within(paused).getByText("Vencido hace 2 días")).toBeInTheDocument();

    // Maintenance never shows a due notice, even past its date.
    const web = screen.getByRole("link", { name: "Web personal" }).closest("article")!;
    expect(within(web).queryByText(/Venc/)).not.toBeInTheDocument();
    // No progress and no "next task" in P1.
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(within(card).queryByText("%")).not.toBeInTheDocument();
  });

  test("the area filter: Todas by default, links with ?area=<slug>", async () => {
    render(await page());
    expect(filterTrigger()).toHaveAccessibleName("Filtrar por área: Todas");
    const option = await openFilter();
    expect(option("Todas las áreas")).toHaveAttribute("aria-current", "page");
    expect(option("Todas las áreas")).toHaveAttribute("href", "/projects");
    expect(option("Trabajo")).toHaveAttribute("href", "/projects?area=work");
    expect(option("Trabajo")).not.toHaveAttribute("aria-current");
  });

  test("?area=work shows only that area's projects and marks its option", async () => {
    render(await page({ area: "work" }));
    expect(filterTrigger()).toHaveAccessibleName("Filtrar por área: Trabajo");
    expectHeadings(2, ["Activo, 1 proyecto", "Mantenimiento, 1 proyecto", "Historial, 1 proyecto"]);
    expect(screen.queryByRole("link", { name: "Mudanza" })).not.toBeInTheDocument();
    const option = await openFilter();
    expect(option("Trabajo")).toHaveAttribute("aria-current", "page");
    expect(option("Todas las áreas")).not.toHaveAttribute("aria-current");
  });

  test("an unknown area slug shows everything", async () => {
    render(await page({ area: "nope" }));
    expect(filterTrigger()).toHaveAccessibleName("Filtrar por área: Todas");
    expect(screen.getByRole("link", { name: "Mudanza" })).toBeInTheDocument();
  });

  test("archived areas that still have projects are an option too", async () => {
    vi.mocked(listLifeAreas).mockResolvedValue([HOME]);
    render(await page());
    const option = await openFilter();
    expect(option(/^Trabajo,\s?Archivada$/)).toBeInTheDocument();
  });

  test("empty state with an explanation and the create key", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    render(await page());
    expect(
      screen.getByRole("heading", { level: 2, name: "Aún no tienes proyectos" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Nuevo proyecto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Historial/ })).not.toBeInTheDocument();
  });

  test("only finished or canceled projects: “nothing in progress”, not “no projects yet”", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ name: "Viaje a Cusco", status: "done" }),
      project({ name: "Tesis", status: "canceled" }),
    ]);
    render(await page());
    expect(screen.getByRole("heading", { level: 2, name: "Nada en curso" })).toBeVisible();
    expect(screen.queryByText("Aún no tienes proyectos")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Historial, 2 proyectos" })).toBeInTheDocument();
  });

  test("a card's link is described by its due notice and high priority", async () => {
    render(await page());
    expect(screen.getByRole("link", { name: "Mudanza" })).toHaveAccessibleDescription(
      "Vence hoy Prioridad alta",
    );
    expect(screen.getByRole("link", { name: "Curso AWS" })).toHaveAccessibleDescription(
      "Vence en 3 días",
    );
    expect(screen.getByRole("link", { name: "Huerto" })).not.toHaveAttribute("aria-describedby");
  });

  test("an area with nothing in progress says so and links back to all areas", async () => {
    vi.mocked(listProjects).mockResolvedValue([project({ status: "done", area: area(WORK) })]);
    render(await page({ area: "work" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Sin proyectos en «Trabajo»" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver todas las áreas" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(screen.getByRole("button", { name: /^Historial/ })).toBeInTheDocument();
  });
});

describe("create sheet", () => {
  const dialog = () => screen.getByRole("dialog");
  const nameField = () => within(dialog()).getByRole("textbox", { name: "Nombre" });
  const areaGroup = () => within(dialog()).getByRole("radiogroup", { name: "Área" });
  const statusGroup = () => within(dialog()).getByRole("radiogroup", { name: "Estado" });
  const createKey = () => within(dialog()).getByRole("button", { name: "Crear proyecto" });

  async function openSheet(search: Record<string, string> = {}) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(await page(search));
    await user.click(screen.getByRole("button", { name: "Nuevo proyecto" }));
    await waitFor(() => expect(nameField()).toBeInTheDocument());
    return user;
  }

  test("bottom sheet on the phone, side panel on desktop; the name has focus", async () => {
    await openSheet();
    expect(dialog()).toHaveAccessibleName("Nuevo proyecto");
    expect(dialog()).toHaveClass("bo-sheet--bottom");
    expect(nameField()).toHaveFocus();
  });

  test("offers only active areas and the four open states, Idea by default", async () => {
    await openSheet();
    expect(
      within(areaGroup())
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Hogar", "Trabajo"]);
    expect(within(areaGroup()).queryByRole("radio", { checked: true })).toBeNull();
    expect(
      within(statusGroup())
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Idea", "Activo", "Pausado", "Mantenimiento"]);
    expect(within(statusGroup()).getByRole("radio", { name: "Idea" })).toBeChecked();
  });

  test("validates on the client: errors on each field, focus on the first", async () => {
    const user = await openSheet();
    await user.click(createKey());
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(PROJECT_ERRORS.nameRequired);
    expect(nameField()).toHaveFocus();
    expect(areaGroup()).toHaveAttribute("aria-invalid", "true");
    expect(createProject).not.toHaveBeenCalled();
  });

  test("creates with name, area and state, then goes to the project's page", async () => {
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      data: project({ id: "33333333-3333-4333-8333-333333333333", name: "Mudanza 2" }),
    });
    const user = await openSheet();
    await user.type(nameField(), "  Mudanza   2 ");
    await user.click(within(areaGroup()).getByRole("radio", { name: "Trabajo" }));
    await user.click(within(statusGroup()).getByRole("radio", { name: "Activo" }));
    await user.click(createKey());

    expect(createProject).toHaveBeenCalledWith({
      name: "Mudanza 2",
      lifeAreaId: WORK.id,
      status: "active",
    });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/projects/33333333-3333-4333-8333-333333333333?created=1",
      ),
    );
  });

  test("Enter in the name submits (fast path on the phone)", async () => {
    vi.mocked(createProject).mockResolvedValue({ ok: true, data: project({ id: "x" }) });
    const user = await openSheet({ area: "home" });
    // The filtered area comes picked.
    expect(within(areaGroup()).getByRole("radio", { name: "Hogar" })).toBeChecked();
    await user.type(nameField(), "Huerto{Enter}");
    expect(createProject).toHaveBeenCalledWith({
      name: "Huerto",
      lifeAreaId: HOME.id,
      status: "idea",
    });
  });

  test("an area archived meanwhile shows on its field; nothing navigates", async () => {
    vi.mocked(createProject).mockResolvedValue({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    });
    const user = await openSheet();
    await user.type(nameField(), "Huerto");
    await user.click(within(areaGroup()).getByRole("radio", { name: "Hogar" }));
    await user.click(createKey());
    await waitFor(() => expect(areaGroup()).toHaveAttribute("aria-invalid", "true"));
    expect(within(dialog()).getByText(PROJECT_ERRORS.areaUnavailable)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  test("a lost session shows on top of the form", async () => {
    vi.mocked(createProject).mockResolvedValue({ ok: false, error: UNAUTHORIZED_MESSAGE });
    const user = await openSheet();
    await user.type(nameField(), "Huerto");
    await user.click(within(areaGroup()).getByRole("radio", { name: "Hogar" }));
    await user.click(createKey());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(UNAUTHORIZED_MESSAGE);
  });

  test("without active areas it explains why and can't create", async () => {
    vi.mocked(listLifeAreas).mockResolvedValue([]);
    vi.mocked(listProjects).mockResolvedValue([]);
    const user = await openSheet();
    expect(within(dialog()).getByText(/No tienes áreas activas/)).toBeInTheDocument();
    expect(createKey()).toHaveAttribute("aria-disabled", "true");
    expect(createKey()).toHaveAccessibleDescription(/No tienes áreas activas/);
    await user.type(nameField(), "Huerto{Enter}");
    await user.click(createKey());
    expect(createProject).not.toHaveBeenCalled();
    // Nothing to fix in the form: no field errors appear.
    expect(nameField()).not.toHaveAttribute("aria-invalid", "true");
  });

  test("while creating: announced, and neither ✕ nor Esc closes the sheet", async () => {
    vi.mocked(createProject).mockReturnValue(new Promise(() => {}));
    const user = await openSheet({ area: "home" });
    await user.type(nameField(), "Huerto");
    await user.click(createKey());

    expect(await within(dialog()).findByText("Creando proyecto…")).toHaveAttribute(
      "role",
      "status",
    );
    const close = within(dialog()).getByRole("button", { name: "Cerrar" });
    expect(close).toHaveAttribute("aria-disabled", "true");
    await user.click(close);
    await user.keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();
  });

  test("an area that drops out of the list is no longer picked or sent", async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      defaultAreaId: HOME.id,
      returnFocusRef: { current: null },
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<ProjectSheet {...props} areas={[area(HOME), area(WORK)]} />);
    expect(within(areaGroup()).getByRole("radio", { name: "Hogar" })).toBeChecked();

    // The page came back with Hogar archived (after "areaUnavailable").
    rerender(<ProjectSheet {...props} areas={[area(WORK)]} />);
    expect(within(areaGroup()).queryByRole("radio", { checked: true })).toBeNull();
    await user.type(nameField(), "Huerto{Enter}");
    expect(createProject).not.toHaveBeenCalled();
    expect(areaGroup()).toHaveAccessibleDescription(/Elige un área\./);
  });
});

describe("ProjectCard", () => {
  test("shows the objective when there is one, and no due notice without one", () => {
    render(
      <ProjectCard
        project={project({ name: "Certificación", objective: "Aprobar con más de 800." })}
        due={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Certificación" })).toBeInTheDocument();
    expect(screen.getByText("Aprobar con más de 800.")).toBeInTheDocument();
    expect(screen.queryByRole("time")).not.toBeInTheDocument();
  });

  test("overdue and today notices use the signal color; soon ones don't", () => {
    const { rerender } = render(
      <ProjectCard
        project={project({ dueDate: "2026-09-30" })}
        due={{ kind: "overdue", days: 1, label: "Vencido hace 1 día" }}
      />,
    );
    expect(screen.getByText("Vencido hace 1 día")).toHaveClass("text-signal-text");
    rerender(
      <ProjectCard
        project={project({ dueDate: "2026-10-03" })}
        due={{ kind: "soon", days: 2, label: "Vence en 2 días" }}
        headingLevel={4}
      />,
    );
    expect(screen.getByText("Vence en 2 días")).toHaveClass("text-text-secondary");
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  test("a done project shows the day it was finished (Lima), not a due notice", () => {
    render(
      <ProjectCard
        project={project({
          status: "done",
          dueDate: "2026-09-01",
          // 23:30 on Oct 2 in Lima is already Oct 3 in UTC: the card says Oct 2.
          completedAt: new Date("2026-10-03T04:30:00.000Z"),
        })}
        due={null}
      />,
    );
    expect(screen.getByText("Terminado el 2 oct. 2026")).toHaveAttribute(
      "datetime",
      "2026-10-03T04:30:00.000Z",
    );
  });

  test("no finish date on any other state", () => {
    render(<ProjectCard project={project({ status: "canceled" })} due={null} />);
    expect(screen.queryByText(/Terminado el/)).not.toBeInTheDocument();
  });
});

describe("list: after deleting a project", () => {
  const DELETED = { id: "00000000-0000-4000-8000-0000000000aa", name: "Huerto viejo" };

  test("focus on the heading, the URL cleaned, and “Proyecto eliminado · Deshacer”", async () => {
    vi.mocked(getDeletedProject).mockResolvedValue(DELETED);
    vi.mocked(restoreProject).mockResolvedValue({
      ok: true,
      data: project({ id: DELETED.id, name: DELETED.name }),
    });
    window.history.replaceState(null, "", `/projects?deleted=${DELETED.id}`);
    render(await page({ deleted: DELETED.id }));

    expect(getDeletedProject).toHaveBeenCalledWith(DELETED.id);
    expect(screen.getByRole("heading", { level: 1, name: "Proyectos" })).toHaveFocus();
    expect(window.location.search).toBe("");
    const notices = screen.getByRole("region", { name: "Avisos" });
    await waitFor(() => expect(notices).toHaveTextContent("«Huerto viejo» se eliminó."));
    expect(notices).toHaveTextContent("Proyecto eliminado");

    const user = userEvent.setup();
    await user.click(within(notices).getByRole("button", { name: "Deshacer" }));
    expect(restoreProject).toHaveBeenCalledWith({ id: DELETED.id });
    await waitFor(() =>
      expect(notices).toHaveTextContent("«Huerto viejo» volvió a tus proyectos."),
    );
  });

  test("an undo that fails says so", async () => {
    vi.mocked(getDeletedProject).mockResolvedValue(DELETED);
    vi.mocked(restoreProject).mockRejectedValue(new Error("offline"));
    render(await page({ deleted: DELETED.id }));
    const notices = screen.getByRole("region", { name: "Avisos" });
    const undo = await within(notices).findByRole("button", { name: "Deshacer" });
    await userEvent.setup().click(undo);
    await waitFor(() =>
      expect(notices).toHaveTextContent("No se pudo deshacer. Inténtalo de nuevo."),
    );
  });

  test("without ?deleted there is no query; once restored there is no notice", async () => {
    const { unmount } = render(await page());
    expect(getDeletedProject).not.toHaveBeenCalled();
    unmount();

    vi.mocked(getDeletedProject).mockResolvedValue(null);
    render(await page({ deleted: "00000000-0000-4000-8000-0000000000bb" }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByText("Proyecto eliminado")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Proyectos" })).not.toHaveFocus();
  });
});
