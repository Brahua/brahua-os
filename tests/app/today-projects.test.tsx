// D3 of `today`: the "Proyectos" section (SPEC-today "Proyectos"). Read only: one row per project
// of `getProjectsTodaySummary`, in its order, with the area's LED, the due notice of `projects`
// and "Bloqueado por …", each row a link to its project. The projects list's colors, never red.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dueState } from "@/modules/projects/progress";
import type { ProjectTodayItem } from "@/modules/projects/today-summary";
import { TodayBoard } from "@/modules/today/components/today-board";
import { TodayProjects } from "@/modules/today/components/today-projects";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

/** Friday 2026-10-02, 10:00 in Lima. */
const NOW = new Date("2026-10-02T15:00:00.000Z");

let serial = 0;
function project(values: Partial<ProjectTodayItem> = {}): ProjectTodayItem {
  serial += 1;
  const item: ProjectTodayItem = {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Proyecto ${serial}`,
    area: { id: "a1", slug: "travel", name: "Planes y Viajes", icon: "plane", color: "travel" },
    status: "active",
    priority: "medium",
    dueDate: null,
    due: null,
    blockedBy: [],
    ...values,
  };
  return { ...item, due: values.due ?? dueState(item.dueDate, item.status, NOW) };
}

const list = () => screen.getByRole("list", { name: /Proyectos que vencen pronto/ });
const row = (name: string) => screen.getByRole("link", { name }).closest("li")!;

describe("rows", () => {
  test("due in 3 days: name links to the project, with the area and the notice", () => {
    const pasaporte = project({ name: "Renovar pasaporte", dueDate: "2026-10-05" });
    render(<TodayProjects projects={[pasaporte]} />);

    const link = screen.getByRole("link", { name: "Renovar pasaporte" });
    expect(link).toHaveAttribute("href", `/projects/${pasaporte.id}`);
    expect(link).toHaveAccessibleDescription("Planes y Viajes, Vence en 3 días");
    const due = within(row("Renovar pasaporte")).getByText("Vence en 3 días");
    expect(due.tagName).toBe("TIME");
    expect(due).toHaveAttribute("dateTime", "2026-10-05");
    // The area's LED, in its color.
    expect(row("Renovar pasaporte").querySelector(".bo-led.bo-area--travel")).not.toBeNull();
  });

  test("due today and overdue: the projects' own labels, in its signal color (never red)", () => {
    render(
      <TodayProjects
        projects={[
          project({ name: "Ruta por Europa", status: "paused", dueDate: "2026-09-30" }),
          project({ name: "Viaje a Cusco", dueDate: "2026-10-02" }),
          project({ name: "Pronto", dueDate: "2026-10-05" }),
        ]}
      />,
    );
    const overdue = within(row("Ruta por Europa")).getByText("Vencido hace 2 días");
    const today = within(row("Viaje a Cusco")).getByText("Vence hoy");
    for (const label of [overdue, today]) {
      // The same color as the projects list's cards.
      expect(label).toHaveClass("text-signal-text");
      expect(label.className).not.toMatch(/danger|red/);
    }
    // Due later: the row's secondary color (positive control).
    expect(within(row("Pronto")).getByText("Vence en 3 días")).not.toHaveClass("text-signal-text");
  });

  test("blocked by several: every blocker's name, also in the link's description", () => {
    const boda = project({
      name: "Boda",
      blockedBy: [
        { id: "b1", name: "Ahorrar" },
        { id: "b2", name: "Elegir el local" },
      ],
    });
    render(<TodayProjects projects={[boda]} />);
    expect(within(row("Boda")).getByText("Bloqueado por Ahorrar, Elegir el local")).toBeVisible();
    expect(screen.getByRole("link", { name: "Boda" })).toHaveAccessibleDescription(
      "Planes y Viajes, Bloqueado por Ahorrar, Elegir el local",
    );
    // Blocked only (no due date): no notice.
    expect(row("Boda").querySelector("time")).toBeNull();
  });

  test("due and blocked: both, notice first", () => {
    render(
      <TodayProjects
        projects={[
          project({ name: "Mudanza", dueDate: "2026-10-03", blockedBy: [{ id: "b", name: "X" }] }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Mudanza" })).toHaveAccessibleDescription(
      "Planes y Viajes, Vence en 1 día, Bloqueado por X",
    );
  });

  test("not blocked: no Bloqueado line (positive control above)", () => {
    render(<TodayProjects projects={[project({ name: "Solo", dueDate: "2026-10-04" })]} />);
    expect(within(row("Solo")).queryByText(/Bloqueado/)).toBeNull();
  });

  test("every project, in the contract's order, with no cap", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      project({ name: `P${i + 1}`, dueDate: "2026-10-04" }),
    );
    render(<TodayProjects projects={many} />);
    expect(
      within(list())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
  });
});

test("the section: an h2 'Proyectos' that takes focus and a link to the module", () => {
  render(<TodayProjects projects={[project({ dueDate: "2026-10-04" })]} />);
  const heading = screen.getByRole("heading", { level: 2, name: "Proyectos" });
  expect(heading).toHaveAttribute("id", "today-projects-title");
  expect(heading).toHaveAttribute("tabindex", "-1");
  const region = screen.getByRole("region", { name: "Proyectos" });
  expect(within(region).getByRole("link", { name: "Ver proyectos" })).toHaveAttribute(
    "href",
    "/projects",
  );
});

test("no rows: nothing at all", () => {
  const { container } = render(<TodayProjects projects={[]} />);
  expect(container).toBeEmptyDOMElement();
});

describe("on the board", () => {
  test("with projects: the section, last, and no empty day", () => {
    const items = [project({ name: "Viaje", dueDate: "2026-10-02" })];
    render(
      <TodayBoard
        today="2026-10-02"
        habits={[]}
        projects={{ count: items.length, content: <TodayProjects projects={items} /> }}
      />,
    );
    expect(screen.getByRole("region", { name: "Proyectos" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Nada programado para hoy" })).toBeNull();
  });

  test("with none: no section, the empty day", () => {
    render(
      <TodayBoard
        today="2026-10-02"
        habits={[]}
        projects={{ count: 0, content: <TodayProjects projects={[]} /> }}
      />,
    );
    expect(screen.queryByRole("region", { name: "Proyectos" })).toBeNull();
    expect(screen.getByRole("region", { name: "Nada programado para hoy" })).toBeInTheDocument();
  });
});
