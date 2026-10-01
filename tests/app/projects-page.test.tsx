import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProjectNotFound from "@/app/(app)/projects/[id]/not-found";
import ProjectPage, { generateMetadata } from "@/app/(app)/projects/[id]/page";
import ProjectsPage, { metadata } from "@/app/(app)/projects/page";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";
import { createProject } from "@/modules/projects/actions";
import { ProjectCard } from "@/modules/projects/components/project-card";
import { PROJECT_ERRORS, type ProjectSummary } from "@/modules/projects/project-input";
import { getProject, listProjects } from "@/modules/projects/queries";

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
vi.mock("@/modules/projects/queries", () => ({ listProjects: vi.fn(), getProject: vi.fn() }));
vi.mock("@/modules/projects/actions", () => ({ createProject: vi.fn() }));

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
    dueDate: null,
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
  vi.mocked(createProject).mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const groupHeadings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
const cardsIn = (status: string) =>
  within(screen.getByRole("list", { name: `Proyectos: ${status}` }))
    .getAllByRole("link")
    .map((link) => link.textContent);
const chip = (name: string) =>
  within(screen.getByRole("navigation", { name: "Filtrar por área" })).getByRole("link", {
    name,
  });

describe("list", () => {
  test("has its title and checks the owner", async () => {
    expect(metadata.title).toBe("Proyectos · brahua-os");
    render(await page());
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Proyectos" })).toBeInTheDocument();
  });

  test("groups by state in order (Activo, Mantenimiento, Pausado, Idea) and sorts inside", async () => {
    render(await page());
    expect(groupHeadings()).toEqual([
      "Activo2",
      "Mantenimiento1",
      "Pausado1",
      "Idea1",
      "Historial2",
    ]);
    // High priority first, whatever the dates.
    expect(cardsIn("Activo")).toEqual(["Mudanza", "Curso AWS"]);
  });

  test("Historial is folded with its count, and opens to Terminado and Cancelado", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(await page());
    const toggle = screen.getByRole("button", { name: /^Historial/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2");
    expect(screen.queryByRole("link", { name: "Viaje a Cusco" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(expect.arrayContaining(["Terminado1", "Cancelado1"]));
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
    expect(chip("Todas")).toHaveAttribute("aria-current", "page");
    expect(chip("Todas")).toHaveAttribute("href", "/projects");
    expect(chip("Trabajo")).toHaveAttribute("href", "/projects?area=work");
    expect(chip("Trabajo")).not.toHaveAttribute("aria-current");
  });

  test("?area=work shows only that area's projects and marks its chip", async () => {
    render(await page({ area: "work" }));
    expect(chip("Trabajo")).toHaveAttribute("aria-current", "page");
    expect(chip("Todas")).not.toHaveAttribute("aria-current");
    expect(groupHeadings()).toEqual(["Activo1", "Mantenimiento1", "Historial1"]);
    expect(screen.queryByRole("link", { name: "Mudanza" })).not.toBeInTheDocument();
  });

  test("an unknown area slug shows everything", async () => {
    render(await page({ area: "nope" }));
    expect(chip("Todas")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Mudanza" })).toBeInTheDocument();
  });

  test("archived areas that still have projects get a chip too", async () => {
    vi.mocked(listLifeAreas).mockResolvedValue([HOME]);
    render(await page());
    expect(chip("Trabajo")).toBeInTheDocument();
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
      expect(router.push).toHaveBeenCalledWith("/projects/33333333-3333-4333-8333-333333333333"),
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
    await user.type(nameField(), "Huerto");
    await user.click(createKey());
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("detail (P1)", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  test("shows name, state, area and priority, with a way back", async () => {
    vi.mocked(getProject).mockResolvedValue(PROJECTS[0]);
    render(await ProjectPage(params(PROJECTS[0].id)));
    expect(requireOwner).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Mudanza" })).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Hogar")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(await generateMetadata(params(PROJECTS[0].id))).toEqual({
      title: "Mudanza · brahua-os",
    });
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
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Este proyecto no está");
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute(
      "href",
      "/projects",
    );
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
});
