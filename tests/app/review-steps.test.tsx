// `weekly-review` W2: the frame of the ritual and step 1 · Logros as the owner sees them (server
// components rendered with their data), and the placeholder of steps 3 and 4.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ReviewShell } from "@/modules/weekly-review/components/review-shell";
import { StepLogros } from "@/modules/weekly-review/components/step-logros";
import { StepSoon } from "@/modules/weekly-review/components/step-soon";
import type { LogrosModel } from "@/modules/weekly-review/logros";

const WEEK = "2026-10-12";

function model(values: Partial<LogrosModel> = {}): LogrosModel {
  return {
    weekStart: WEEK,
    completeDays: 4,
    habits: { done: 18, expected: 24 },
    tasksDone: 11,
    milestonesDone: 2,
    goalsAchieved: 1,
    topHabits: [{ id: "h1", name: "Correr", done: 6, expected: 7 }],
    recentTasks: [{ id: "t1", title: "Pagar la luz" }],
    milestones: [{ id: "m1", title: "Primer prototipo", projectName: "Lanzar brahua-os" }],
    goals: [{ id: "g1", title: "Leer 12 libros", href: "/goals/g1" }],
    quiet: false,
    ...values,
  };
}

describe("ReviewShell", () => {
  function shell(step: 1 | 2 | 3 | 4, extra: { currentWeek?: string | null } = {}) {
    return render(
      <ReviewShell headingId="t" weekStart={WEEK} step={step} {...extra}>
        <p>contenido</p>
      </ReviewShell>,
    );
  }

  test("the week is the heading and the progress shows the four steps with the current one marked", () => {
    shell(2);
    expect(
      screen.getByRole("heading", { level: 1, name: "Del 12 al 18 de octubre" }),
    ).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Pasos de la revisión" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.textContent)).toEqual([
      "1Logros",
      "2Pendientes",
      "3Metas y proyectos",
      "4Próxima semana",
    ]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "step")).toEqual([
      links[1],
    ]);
    // Plain links that keep the week.
    expect(links[0]).toHaveAttribute("href", `/review?semana=${WEEK}`);
    expect(links[2]).toHaveAttribute("href", `/review?paso=3&semana=${WEEK}`);
    expect(screen.getByRole("heading", { level: 2, name: /Pendientes/ })).toBeVisible();
  });

  test("«Atrás» and «Seguir» are links to the neighbor steps; the ends have only one", () => {
    const { unmount } = shell(1);
    expect(screen.queryByRole("link", { name: "Atrás" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Seguir" })).toHaveAttribute(
      "href",
      `/review?paso=2&semana=${WEEK}`,
    );
    unmount();

    const middle = shell(3);
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      `/review?paso=2&semana=${WEEK}`,
    );
    expect(screen.getByRole("link", { name: "Seguir" })).toHaveAttribute(
      "href",
      `/review?paso=4&semana=${WEEK}`,
    );
    middle.unmount();

    shell(4);
    expect(screen.getByRole("link", { name: "Atrás" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Seguir" })).not.toBeInTheDocument();
  });

  test("«Ver esta semana» only shows when another week is under review", () => {
    const { unmount } = shell(1);
    expect(screen.queryByRole("link", { name: "Ver esta semana" })).not.toBeInTheDocument();
    unmount();
    shell(2, { currentWeek: "2026-10-19" });
    expect(screen.getByRole("link", { name: "Ver esta semana" })).toHaveAttribute(
      "href",
      "/review?paso=2&semana=2026-10-19",
    );
  });
});

describe("StepLogros", () => {
  test("shows «Días completos», the four figures and the highlights", () => {
    render(<StepLogros model={model()} />);
    expect(screen.getByText("Días completos esta semana: 4")).toBeVisible();
    const figures = document.querySelector("[data-review-figures]") as HTMLElement;
    const read = (key: string) => within(figures.querySelector(`[data-figure=${key}]`)!);
    expect(read("habits").getByText("18 de 24")).toBeVisible();
    expect(read("habits").getByText("hábitos")).toBeVisible();
    expect(read("tasks").getAllByText("11").length).toBeGreaterThan(0);
    expect(read("tasks").getByText("tareas hechas")).toBeVisible();
    expect(read("milestones").getByText("hitos de proyectos")).toBeVisible();
    expect(read("goals").getByText("metas logradas")).toBeVisible();

    expect(screen.getByRole("heading", { name: "Los hábitos más constantes" })).toBeVisible();
    expect(screen.getByText("Correr · 6 de 7")).toBeVisible();
    expect(screen.getByText("Pagar la luz")).toBeVisible();
    expect(screen.getByText("Primer prototipo · Lanzar brahua-os")).toBeVisible();
    expect(screen.getByRole("link", { name: "Leer 12 libros" })).toHaveAttribute(
      "href",
      "/goals/g1",
    );
    expect(screen.queryByText("Una semana tranquila")).not.toBeInTheDocument();
  });

  test("a week with nothing says «Una semana tranquila», without highlights or scolding", () => {
    render(
      <StepLogros
        model={model({
          completeDays: 0,
          habits: { done: 0, expected: 0 },
          tasksDone: 0,
          milestonesDone: 0,
          goalsAchieved: 0,
          topHabits: [],
          recentTasks: [],
          milestones: [],
          goals: [],
          quiet: true,
        })}
      />,
    );
    expect(screen.getByText("Una semana tranquila")).toBeVisible();
    // No «0 de 0» for habits that don't exist.
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    const text = document.body.textContent ?? "";
    for (const word of ["atrasad", "fallaste", "riesgo", "deuda"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  test("the habits' figure is real even when only some highlights exist", () => {
    render(
      <StepLogros model={model({ topHabits: [], recentTasks: [], milestones: [], goals: [] })} />,
    );
    expect(screen.getByText("18 de 24")).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});

describe("StepSoon", () => {
  test("says the part is coming without promising a date", () => {
    render(<StepSoon />);
    expect(screen.getByText("Esta parte llega pronto")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\d{4}|pronto\s+\d|semana que viene|mañana/i);
  });
});
