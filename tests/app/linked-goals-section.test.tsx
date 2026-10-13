// G3 of `goals`: the "Metas" section on a habit's or project's page (a Server Component, rendered
// here as is): the goals that follow it, each with period, bar, count and a link; nothing when
// there are none.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LinkedGoalsSection } from "@/modules/goals/components/linked-goals-section";
import type { GoalItem } from "@/modules/goals/goal-input";

const TODAY = "2026-10-12";
const HABIT_ID = "11111111-1111-4111-8111-111111111111";

function goal(values: Partial<GoalItem>): GoalItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Correr 200 días",
    notes: null,
    periodKind: "year",
    year: 2026,
    quarter: null,
    sourceKind: "habit",
    habitId: HABIT_ID,
    projectId: null,
    target: 200,
    unit: null,
    status: "active",
    achievedAt: null,
    position: 1,
    area: null,
    sum: 0,
    source: { kind: "habit", name: "Correr", done: 34, expected: 40 },
    ...values,
  };
}

describe("LinkedGoalsSection", () => {
  test("renders nothing without goals", () => {
    const { container } = render(
      <LinkedGoalsSection sourceName="Correr" goals={[]} today={TODAY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("lists each goal with its period, bar, count and a link to its page", () => {
    render(
      <LinkedGoalsSection
        sourceName="Correr"
        today={TODAY}
        goals={[
          goal({}),
          goal({
            id: "00000000-0000-4000-8000-000000000002",
            title: "Correr en T4",
            periodKind: "quarter",
            quarter: 4,
            target: 40,
            source: { kind: "habit", name: "Correr", done: 40, expected: 40 },
            status: "achieved",
            achievedAt: "2026-10-10T12:00:00.000Z",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Metas" })).toBeInTheDocument();
    expect(screen.getByText("Metas que siguen «Correr».")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Metas enlazadas" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const year = rows[0];
    expect(
      within(year).getByRole("link", { name: "Abrir la meta «Correr 200 días»" }),
    ).toHaveAttribute("href", "/goals/00000000-0000-4000-8000-000000000001");
    expect(within(year).getByText("2026")).toBeInTheDocument();
    const bar = within(year).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "34");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
    expect(within(year).getByText("34 de 200 días")).toBeInTheDocument();
    // A line of pace, never a reproach.
    expect(year.textContent).not.toMatch(/atrasad|riesgo|fallaste|deuda/i);

    const quarter = rows[1];
    expect(within(quarter).getByText("T4 2026")).toBeInTheDocument();
    // The status is a word, not only a color.
    expect(within(quarter).getByText("Lograda")).toBeInTheDocument();
    expect(within(quarter).getByText("40 de 40 días")).toBeInTheDocument();
  });

  test("a goal whose source can't be read says so, without a bar", () => {
    render(
      <LinkedGoalsSection sourceName="Correr" today={TODAY} goals={[goal({ source: null })]} />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/ya no está/)).toBeInTheDocument();
  });

  test("a project goal shows its percentage", () => {
    render(
      <LinkedGoalsSection
        sourceName="Lanzar brahua-os"
        today={TODAY}
        goals={[
          goal({
            title: "Lanzar v1",
            sourceKind: "project",
            habitId: null,
            projectId: "22222222-2222-4222-8222-222222222222",
            target: 100,
            source: { kind: "project", name: "Lanzar brahua-os", percent: 62, finished: false },
          }),
        ]}
      />,
    );
    expect(screen.getByText("62 %")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
  });
});
