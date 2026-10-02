// "Cerrar proyecto" (Checkpoint final de projects): the pure rules and the confirm step's text.
import { describe, expect, test } from "vitest";
import {
  CLOSED_STATUSES,
  hasOpenWork,
  isClosed,
  OPEN_STATUSES,
  openWork,
  REOPEN_STATUS,
} from "@/modules/projects/project-close";
import { closeProjectInputSchema, CREATE_PROJECT_STATUSES } from "@/modules/projects/project-input";
import { CLOSE_COPY } from "@/modules/projects/projects-copy";

const ID = "00000000-0000-4000-8000-000000000001";

describe("states", () => {
  test("open and closed split the six states; a project is created and reopened open", () => {
    expect([...OPEN_STATUSES, ...CLOSED_STATUSES].sort()).toEqual(
      ["active", "canceled", "done", "idea", "maintenance", "paused"].sort(),
    );
    expect(CREATE_PROJECT_STATUSES).toEqual(OPEN_STATUSES);
    expect(OPEN_STATUSES).toContain(REOPEN_STATUS);
    expect(REOPEN_STATUS).toBe("active");
  });

  test("isClosed: only done and canceled", () => {
    expect(isClosed("done")).toBe(true);
    expect(isClosed("canceled")).toBe(true);
    for (const status of OPEN_STATUSES) expect(isClosed(status)).toBe(false);
  });

  test("closing takes Terminado or Cancelado and a uuid, nothing else", () => {
    expect(closeProjectInputSchema.parse({ id: ID, status: "done" })).toEqual({
      id: ID,
      status: "done",
    });
    expect(closeProjectInputSchema.safeParse({ id: ID, status: "canceled" }).success).toBe(true);
    expect(closeProjectInputSchema.safeParse({ id: ID, status: "active" }).success).toBe(false);
    expect(closeProjectInputSchema.safeParse({ id: "nope", status: "done" }).success).toBe(false);
  });
});

describe("openWork", () => {
  test("total − done of the milestones and of the progress sources, apart", () => {
    expect(openWork({ done: 1, total: 3 }, { done: 2, total: 10 })).toEqual({
      milestones: 2,
      tasks: 8,
    });
    expect(openWork({ done: 3, total: 3 })).toEqual({ milestones: 0, tasks: 0 });
    expect(openWork(undefined, null)).toEqual({ milestones: 0, tasks: 0 });
  });

  test("bad pairs are cleaned like the progress (whole, done ≤ total, not negative)", () => {
    expect(openWork({ done: 5, total: 3 }, { done: -1, total: 2.7 })).toEqual({
      milestones: 0,
      tasks: 2,
    });
  });

  test("hasOpenWork", () => {
    expect(hasOpenWork({ milestones: 0, tasks: 0 })).toBe(false);
    expect(hasOpenWork({ milestones: 0, tasks: 1 })).toBe(true);
  });
});

describe("the confirm step's warning", () => {
  test.each([
    [{ milestones: 1, tasks: 0 }, "Queda 1 hito abierto. ¿Terminar igual?"],
    [{ milestones: 2, tasks: 0 }, "Quedan 2 hitos abiertos. ¿Terminar igual?"],
    [{ milestones: 0, tasks: 1 }, "Queda 1 tarea abierta. ¿Terminar igual?"],
    [{ milestones: 0, tasks: 4 }, "Quedan 4 tareas abiertas. ¿Terminar igual?"],
    [{ milestones: 1, tasks: 1 }, "Quedan 1 hito abierto y 1 tarea abierta. ¿Terminar igual?"],
    [{ milestones: 3, tasks: 2 }, "Quedan 3 hitos abiertos y 2 tareas abiertas. ¿Terminar igual?"],
  ])("%o → %s", (open, text) => {
    expect(CLOSE_COPY.openWorkWarning(open)).toBe(text);
  });

  test("nothing open: no warning", () => {
    expect(CLOSE_COPY.openWorkWarning({ milestones: 0, tasks: 0 })).toBeNull();
  });

  test("the result names what was left open, in the past", () => {
    expect(CLOSE_COPY.done("Mudanza", { milestones: 0, tasks: 0 })).toBe(
      "«Mudanza» se marcó como terminado.",
    );
    expect(CLOSE_COPY.done("Mudanza", { milestones: 1, tasks: 0 })).toBe(
      "«Mudanza» se marcó como terminado. Quedó 1 hito abierto.",
    );
    expect(CLOSE_COPY.done("Mudanza", { milestones: 2, tasks: 1 })).toBe(
      "«Mudanza» se marcó como terminado. Quedaron 2 hitos abiertos y 1 tarea abierta.",
    );
  });
});
