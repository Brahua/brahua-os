// `weekly-review` W3: step 3 · Metas y proyectos, the closing screen and «Semanas anteriores» as
// the owner sees them (server components rendered with their data).
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { celebrate } from "@/lib/celebrate";
import { ClosingScreen } from "@/modules/weekly-review/components/closing-screen";
import { PreviousWeeks } from "@/modules/weekly-review/components/previous-weeks";
import {
  METAS_GOALS_LISTED,
  StepMetas,
  filledOf,
} from "@/modules/weekly-review/components/step-metas";
import type { GoalWeekReviewItem } from "@/modules/goals/contracts";
import type { ProjectWeekReviewItem } from "@/modules/projects/contracts";
import type { LogrosModel } from "@/modules/weekly-review/logros";

vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn() }));

function goal(values: Partial<GoalWeekReviewItem> = {}): GoalWeekReviewItem {
  return {
    id: "g1",
    title: "Leer 12 libros",
    href: "/goals/g1",
    sourceKind: "manual",
    value: 5,
    target: 12,
    unit: "libros",
    count: "5 de 12 libros",
    ratio: 5 / 12,
    paceState: "next-step",
    perWeekNeeded: 1,
    line: "Para llegar: ~1 libro por semana",
    ...values,
  };
}

function project(values: Partial<ProjectWeekReviewItem> = {}): ProjectWeekReviewItem {
  return {
    id: "p1",
    name: "Lanzar brahua-os",
    status: "active",
    progressPercent: 40,
    nextAction: { id: "t1", title: "Escribir la spec" },
    blockedBy: [],
    ...values,
  };
}

describe("StepMetas", () => {
  test("a goal shows its link, its bar, the count and the pace line", () => {
    render(<StepMetas goals={[goal()]} projects={[]} />);
    expect(screen.getByRole("link", { name: "Leer 12 libros" })).toHaveAttribute(
      "href",
      "/goals/g1",
    );
    const bar = screen.getByRole("progressbar", { name: "Leer 12 libros: 5 de 12 libros" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "5 de 12 libros");
    expect(screen.getByText("5 de 12 libros")).toBeVisible();
    expect(screen.getByText("Para llegar: ~1 libro por semana")).toBeVisible();
  });

  test("a goal whose source is gone shows its line and no bar", () => {
    render(
      <StepMetas
        goals={[goal({ count: null, ratio: 0, paceState: "unavailable", line: "Ya no existe" })]}
        projects={[]}
      />,
    );
    expect(screen.getByText("Ya no existe")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  test("a project shows its progress, its next action and, when blocked, the fact", () => {
    render(
      <StepMetas
        goals={[]}
        projects={[
          project(),
          project({
            id: "p2",
            name: "Mudanza",
            status: "paused",
            nextAction: null,
            blockedBy: [
              { id: "x", name: "Comprar el dominio" },
              { id: "y", name: "Pagar el depósito" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Lanzar brahua-os" })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    expect(screen.getAllByText("40 % completado")).toHaveLength(2);
    expect(screen.getByText("Siguiente: Escribir la spec")).toBeVisible();
    expect(screen.getByText("Sin siguiente acción por ahora")).toBeVisible();
    expect(screen.getByText("Pausado", { exact: false })).toBeVisible();
    // A fact, not a reproach.
    expect(screen.getByText("Esperando a Comprar el dominio, Pagar el depósito")).toBeVisible();
    expect(screen.getAllByText(/Esperando a/)).toHaveLength(1);
  });

  test("a maintenance project has no end, so it shows no percentage", () => {
    render(
      <StepMetas goals={[]} projects={[project({ status: "maintenance", progressPercent: 0 })]} />,
    );
    expect(screen.queryByText(/% completado/)).not.toBeInTheDocument();
  });

  test("friendly empty states with a link to each screen", () => {
    render(<StepMetas goals={[]} projects={[]} />);
    expect(screen.getByText("Aún no tienes metas activas")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir a Metas" })).toHaveAttribute("href", "/goals");
    expect(screen.getByRole("link", { name: "Ir a Proyectos" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  test("a long list is cut with the number and a link to the rest", () => {
    const many = Array.from({ length: METAS_GOALS_LISTED + 3 }, (_, i) =>
      goal({ id: `g${i}`, title: `Meta ${i}`, href: `/goals/g${i}` }),
    );
    render(<StepMetas goals={many} projects={[]} />);
    const section = screen.getByRole("region", { name: "Metas" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(METAS_GOALS_LISTED);
    expect(
      screen.getByText(
        `Se muestran los primeros ${METAS_GOALS_LISTED} de ${METAS_GOALS_LISTED + 3}.`,
        {
          exact: false,
        },
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver todas las metas" })).toHaveAttribute(
      "href",
      "/goals",
    );
  });

  test("the bar fills completely only when the goal is reached", () => {
    expect(filledOf(0)).toBe(0);
    expect(filledOf(0.5)).toBe(5);
    expect(filledOf(0.99)).toBe(9);
    expect(filledOf(1)).toBe(10);
    expect(filledOf(2)).toBe(10);
    expect(filledOf(-1)).toBe(0);
  });
});

const MODEL: LogrosModel = {
  weekStart: "2026-10-05",
  completeDays: 4,
  habits: { done: 18, expected: 24 },
  tasksDone: 11,
  milestonesDone: 2,
  goalsAchieved: 1,
  topHabits: [],
  recentTasks: [],
  milestones: [],
  goals: [],
  quiet: false,
};

describe("ClosingScreen", () => {
  beforeEach(() => {
    vi.mocked(celebrate).mockReset();
  });

  function closing(values: { note?: string | null; objective?: string | null } = {}) {
    return render(
      <>
        <h1 id="t" tabIndex={-1}>
          Del 5 al 11 de octubre
        </h1>
        <ClosingScreen
          headingId="t"
          model={MODEL}
          note={values.note ?? null}
          objective={values.objective ?? null}
        />
      </>,
    );
  }

  test("ends on what was achieved: the figures, the note, the objective and «Volver a Hoy»", () => {
    closing({ note: "Aprendí a descansar", objective: "Terminar la spec" });
    expect(screen.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
    expect(screen.getByText("Días completos esta semana: 4")).toBeVisible();
    expect(screen.getByText("18 de 24")).toBeVisible();
    expect(screen.getByText("Aprendí a descansar")).toBeVisible();
    expect(screen.getByText("Terminar la spec")).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver a Hoy" })).toHaveAttribute("href", "/");
  });

  test("no note and no objective: no empty sections", () => {
    closing();
    expect(screen.queryByText("Tu nota")).not.toBeInTheDocument();
    expect(screen.queryByText("Tu objetivo de la próxima semana")).not.toBeInTheDocument();
  });

  test("on arrival focus goes to the heading and the celebration plays once", () => {
    closing();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(celebrate).toHaveBeenCalledTimes(1);
  });
});

describe("PreviousWeeks", () => {
  test("lists the weeks with their dates, days, habits and note, each linking to its review", () => {
    render(
      <PreviousWeeks
        weeks={[
          {
            weekStart: "2026-10-05",
            note: "Aprendí a descansar",
            completeDays: 4,
            habitsDone: 18,
            habitsExpected: 24,
          },
          {
            weekStart: "2026-09-28",
            note: null,
            completeDays: 0,
            habitsDone: 0,
            habitsExpected: 0,
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Semanas anteriores" })).toBeVisible();
    const first = screen.getByRole("link", { name: "Del 5 al 11 de octubre" });
    expect(first).toHaveAttribute("href", "/review?semana=2026-10-05");
    const item = first.closest("li") as HTMLElement;
    expect(within(item).getByText(/Días completos: 4/)).toBeVisible();
    expect(within(item).getByText(/18 de 24 hábitos/)).toBeVisible();
    expect(within(item).getByText("Nota: Aprendí a descansar")).toBeVisible();
    const second = screen
      .getByRole("link", { name: "Del 28 de setiembre al 4 de octubre" })
      .closest("li") as HTMLElement;
    expect(within(second).getByText(/Sin hábitos esa semana/)).toBeVisible();
    expect(within(second).queryByText(/Nota:/)).not.toBeInTheDocument();
  });

  test("with no closed week it says when the first will appear", () => {
    render(<PreviousWeeks weeks={[]} />);
    expect(screen.getByText("Cuando cierres tu primera semana, aparecerá aquí.")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
