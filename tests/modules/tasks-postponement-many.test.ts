// evening-close-ritual: `taskPostponement().postponeMany` / `undoMany`, the batch of the close of
// the day: one server call per task, ONE notice, one announcement.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import type { PostponedTask, RestoredDueDate } from "@/modules/tasks/task-postpone";
import { taskPostponement, type PostponedItem } from "@/modules/tasks/task-postponement";

vi.mock("@/modules/tasks/postpone-actions", () => ({
  postponeTask: vi.fn(),
  restoreTaskDueDate: vi.fn(),
}));

const TODAY = "2026-10-02";
const TOMORROW = "2026-10-03";

const push = vi.fn();
const announce = vi.fn();
type Queued<T> = { kind: "done"; value: T } | { kind: "skipped" };
const services = {
  // The real queue runs calls in order; here each call just runs.
  enqueue: async <T>(_key: string | null, run: () => Promise<T>): Promise<Queued<T>> => ({
    kind: "done",
    value: await run(),
  }),
  toaster: { push },
  announce,
} as unknown as Parameters<typeof taskPostponement>[0];

const a = { id: "a", title: "Pagar luz" };
const b = { id: "b", title: "Llamar a mamá" };

function moved(id: string, changed = true): ActionResult<PostponedTask> {
  return ok({ id, title: id, dueDate: TOMORROW, previousDueDate: TODAY, changed });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T02:00:00Z")); // 21:00 on 2026-10-02 in Lima
});

describe("postponeMany", () => {
  test("one call per task, one notice with the count, and one 'Deshacer' with what moved", async () => {
    vi.mocked(postponeTask).mockImplementation(async (input) =>
      moved((input as { id: string }).id),
    );
    const onUndo = vi.fn();
    const outcome = await taskPostponement(services).postponeMany([a, b], "tomorrow", onUndo);
    expect(outcome).toBe("saved");
    expect(postponeTask).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(1);
    const notice = push.mock.calls[0][0];
    expect(notice.title).toBe("Tareas movidas");
    expect(notice.text).toBe("2 tareas pasan a mañana.");
    notice.action.run();
    expect(onUndo).toHaveBeenCalledWith([
      { task: a, moved: expect.objectContaining({ id: "a", previousDueDate: TODAY }) },
      { task: b, moved: expect.objectContaining({ id: "b" }) },
    ]);
  });

  test("a single task reads like the single postponement", async () => {
    vi.mocked(postponeTask).mockResolvedValue(moved("a"));
    await taskPostponement(services).postponeMany([a], "tomorrow", vi.fn());
    expect(push.mock.calls[0][0].title).toBe("Tarea movida");
    expect(push.mock.calls[0][0].text).toBe("«Pagar luz» pasa a mañana.");
  });

  test("a failure goes in the same notice, so the 'Deshacer' of what moved is never replaced", async () => {
    vi.mocked(postponeTask).mockImplementation(async (input) =>
      (input as { id: string }).id === "b" ? fail("Sin conexión.") : moved("a"),
    );
    const onUndo = vi.fn();
    const outcome = await taskPostponement(services).postponeMany([a, b], "tomorrow", onUndo);
    expect(outcome).toBe("saved");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].text).toBe("«Pagar luz» pasa a mañana. Una no se pudo mover.");
    expect(push.mock.calls[0][0].tone).toBeUndefined();
    push.mock.calls[0][0].action.run();
    expect(onUndo).toHaveBeenCalledWith([{ task: a, moved: expect.objectContaining({ id: "a" }) }]);
  });

  test("all fail: only the failure, no 'Deshacer'", async () => {
    vi.mocked(postponeTask).mockResolvedValue(fail("No."));
    const outcome = await taskPostponement(services).postponeMany([a, b], "tomorrow", vi.fn());
    expect(outcome).toBe("failed");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].action).toBeUndefined();
    expect(push.mock.calls[0][0].text).toContain("No se pudieron mover 2 tareas");
  });

  test("all were already there (a double tap): nothing to say or undo", async () => {
    vi.mocked(postponeTask).mockImplementation(async (input) =>
      moved((input as { id: string }).id, false),
    );
    const outcome = await taskPostponement(services).postponeMany([a, b], "tomorrow", vi.fn());
    expect(outcome).toBe("unchanged");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("undoMany", () => {
  const items: PostponedItem[] = [
    {
      task: a,
      moved: { id: "a", title: "a", dueDate: TOMORROW, previousDueDate: TODAY, changed: true },
    },
    {
      task: b,
      moved: {
        id: "b",
        title: "b",
        dueDate: TOMORROW,
        previousDueDate: "2026-10-01",
        changed: true,
      },
    },
  ];

  test("each task goes back to the exact day it had, and it is announced once", async () => {
    vi.mocked(restoreTaskDueDate).mockImplementation(async (input) => {
      const { id, dueDate } = input as { id: string; dueDate: string };
      return ok<RestoredDueDate>({ id, dueDate, restored: true });
    });
    const outcome = await taskPostponement(services).undoMany(items);
    expect(outcome).toBe("saved");
    expect(restoreTaskDueDate).toHaveBeenCalledWith({
      id: "a",
      dueDate: TODAY,
      expected: TOMORROW,
    });
    expect(restoreTaskDueDate).toHaveBeenCalledWith({
      id: "b",
      dueDate: "2026-10-01",
      expected: TOMORROW,
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("2 tareas volvieron a su día.");
  });

  test("a task edited meanwhile is not overwritten, and it says so", async () => {
    vi.mocked(restoreTaskDueDate).mockImplementation(async (input) => {
      const { id } = input as { id: string };
      return ok<RestoredDueDate>({ id, dueDate: "2026-10-09", restored: false });
    });
    const outcome = await taskPostponement(services).undoMany(items);
    expect(outcome).toBe("failed");
    expect(push.mock.calls[0][0].text).toContain("La fecha ya cambió");
    expect(announce).not.toHaveBeenCalled();
  });
});
