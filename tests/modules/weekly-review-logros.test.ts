// W2 of `weekly-review`: the model of step 1 · Logros (what the figures and the highlights are
// built from) and the copy of the two steps.
import { describe, expect, test } from "vitest";
import {
  buildLogros,
  LISTED_GOALS,
  LISTED_MILESTONES,
  topHabits,
  TOP_HABITS,
  type LogrosSources,
} from "@/modules/weekly-review/logros";
import { LOGROS_COPY, PENDIENTES_COPY, REVIEW_COPY } from "@/modules/weekly-review/review-copy";

const habit = (id: string, name: string, done: number, expected: number) => ({
  id,
  name,
  area: null,
  compliance: { done, expected },
});

function sources(overrides: Partial<LogrosSources> = {}): LogrosSources {
  return {
    habits: { weekStart: "2026-10-12", habits: [], total: { done: 0, expected: 0 } },
    completeDays: { weekStart: "2026-10-12", days: [], completeDays: 0 },
    tasks: {
      weekStart: "2026-10-12",
      doneCount: 0,
      recentDone: [],
      open: [],
      openCount: 0,
      inboxCount: 0,
    },
    projects: { weekStart: "2026-10-12", projects: [], milestonesDone: [] },
    goals: { weekStart: "2026-10-12", active: [], achieved: [], entries: [] },
    ...overrides,
  } as LogrosSources;
}

describe("topHabits", () => {
  test("by the share done, then how many, then by name; at most three", () => {
    const rows = [
      habit("a", "Leer", 3, 7),
      habit("b", "Correr", 7, 7),
      habit("c", "Meditar", 6, 7),
      habit("d", "Agua", 6, 7),
      habit("e", "Estirar", 2, 2),
    ];
    expect(topHabits(rows as never).map((row) => row.name)).toEqual(["Correr", "Estirar", "Agua"]);
    expect(topHabits(rows as never)).toHaveLength(TOP_HABITS);
  });

  test("never names a habit with nothing done, or one with nothing expected", () => {
    const rows = [habit("a", "Leer", 0, 7), habit("b", "Libre", 0, 0), habit("c", "Correr", 1, 7)];
    expect(topHabits(rows as never).map((row) => row.name)).toEqual(["Correr"]);
    expect(topHabits([])).toEqual([]);
  });
});

describe("buildLogros", () => {
  test("a week with nothing is quiet, with zeros and no highlights", () => {
    const model = buildLogros("2026-10-12", sources());
    expect(model).toMatchObject({
      quiet: true,
      completeDays: 0,
      habits: { done: 0, expected: 0 },
      tasksDone: 0,
      milestonesDone: 0,
      goalsAchieved: 0,
      topHabits: [],
      recentTasks: [],
      milestones: [],
      goals: [],
    });
  });

  test("brings the four figures, «Días completos» and the highlights", () => {
    const milestones = Array.from({ length: LISTED_MILESTONES + 2 }, (_, index) => ({
      id: `m${index}`,
      title: `Hito ${index}`,
      projectId: "p",
      projectName: "Proyecto",
      doneAt: new Date(),
    }));
    const achieved = Array.from({ length: LISTED_GOALS + 1 }, (_, index) => ({
      id: `g${index}`,
      title: `Meta ${index}`,
      href: `/goals/g${index}`,
      achievedAt: "2026-10-14T10:00:00Z",
    }));
    const model = buildLogros(
      "2026-10-12",
      sources({
        habits: {
          weekStart: "2026-10-12",
          habits: [habit("a", "Correr", 5, 7)],
          total: { done: 18, expected: 24 },
        },
        completeDays: { weekStart: "2026-10-12", days: [], completeDays: 4 },
        tasks: {
          weekStart: "2026-10-12",
          doneCount: 11,
          recentDone: [{ id: "t1", title: "Pagar luz", doneAt: new Date() }],
          open: [],
          openCount: 0,
          inboxCount: 0,
        },
        projects: { weekStart: "2026-10-12", projects: [], milestonesDone: milestones },
        goals: { weekStart: "2026-10-12", active: [], achieved, entries: [] },
      } as never),
    );
    expect(model).toMatchObject({
      quiet: false,
      completeDays: 4,
      habits: { done: 18, expected: 24 },
      tasksDone: 11,
      milestonesDone: LISTED_MILESTONES + 2,
      goalsAchieved: LISTED_GOALS + 1,
    });
    expect(model.topHabits).toEqual([{ id: "a", name: "Correr", done: 5, expected: 7 }]);
    expect(model.recentTasks).toEqual([{ id: "t1", title: "Pagar luz" }]);
    // The figures count them all; the lists name the first few.
    expect(model.milestones).toHaveLength(LISTED_MILESTONES);
    expect(model.goals).toHaveLength(LISTED_GOALS);
  });

  test("a single thing done is not a quiet week", () => {
    const model = buildLogros(
      "2026-10-12",
      sources({
        tasks: {
          weekStart: "2026-10-12",
          doneCount: 1,
          recentDone: [],
          open: [],
          openCount: 0,
          inboxCount: 0,
        },
      }),
    );
    expect(model.quiet).toBe(false);
  });
});

describe("the copy of steps 1 and 2", () => {
  test("says what the spec says", () => {
    expect(LOGROS_COPY.completeDays(4)).toBe("Días completos esta semana: 4");
    expect(LOGROS_COPY.habitsFigure(18, 24)).toBe("18 de 24");
    expect(LOGROS_COPY.quietTitle).toBe("Una semana tranquila");
    expect(PENDIENTES_COPY.open(4)).toBe("Quedaron abiertas 4 tareas.");
    expect(PENDIENTES_COPY.open(1)).toBe("Quedó abierta 1 tarea.");
    expect(PENDIENTES_COPY.moveAll(4)).toBe("Mover las 4 al lunes");
    expect(PENDIENTES_COPY.emptyTitle).toBe("Nada abierto. Buen cierre.");
    expect(PENDIENTES_COPY.moved(3)).toBe("Se movieron 3 tareas.");
    expect(PENDIENTES_COPY.undonePartial(2, 1)).toBe(
      "2 volvieron a su día. 1 no se restauró: cambió mientras tanto.",
    );
    expect(PENDIENTES_COPY.notRestored(3)).toBe("3 no se restauraron: cambiaron mientras tanto.");
    expect(REVIEW_COPY.soonTitle).toBe("Esta parte llega pronto");
  });
});
