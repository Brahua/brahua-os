// A change to a task revalidates /tasks, the project screens and the home page, where `today`
// shows the overdue and due-today tasks (SPEC-today "Revalidación", D2): the board never shows a
// stale task after completing or editing it elsewhere.
import { revalidatePath } from "next/cache";
import { beforeEach, expect, test, vi } from "vitest";
import { revalidateTaskLists, revalidateTaskScreens } from "@/modules/tasks/revalidate";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

test("a task's change revalidates /tasks, its page, every project page and the home page", () => {
  revalidateTaskScreens(ID);
  expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${ID}`);
  expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledTimes(4);
});

test("without its page (a delete): the lists and the home page, never the task's page", () => {
  revalidateTaskScreens(ID, { page: false });
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).not.toHaveBeenCalledWith(`/tasks/${ID}`);
  expect(revalidatePath).toHaveBeenCalledTimes(3);
});

test("the task lists (create, delete) include the home page", () => {
  revalidateTaskLists();
  expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledTimes(3);
});
