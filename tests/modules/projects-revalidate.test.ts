// A change to a project revalidates the home page too, where `today` shows the projects due
// within a week and the blocked ones (SPEC-today "Revalidación", D3): the board never shows a
// stale project after editing it elsewhere. The actions run against fake writes; ownerAction is
// reduced to its Zod parse (its owner check has its own tests).
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  addDependency,
  changeProjectArea,
  changeProjectPriority,
  changeProjectStatus,
  deleteProject,
  removeDependency,
  renameProject,
  restoreProject,
  updateProjectDates,
} from "@/modules/projects/actions";
import { closeProject, reopenProject } from "@/modules/projects/close-actions";
import { revalidateProjectListings, revalidateProjectScreens } from "@/modules/projects/revalidate";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/owner-action", () => ({
  ownerAction:
    (schema: { parse: (input: unknown) => unknown }, handler: (data: unknown) => unknown) =>
    async (input: unknown) =>
      handler(schema.parse(input)),
}));
vi.mock("@/lib/progress-sources", () => ({ ensureProgressSources: vi.fn() }));
vi.mock("@/modules/projects/contracts", () => ({
  contributedProgress: vi.fn(async () => new Map()),
}));
vi.mock("@/modules/projects/milestones", () => ({
  selectProjectMilestoneCounts: vi.fn(async () => ({ done: 0, total: 0 })),
}));

const PROJECT = vi.hoisted(() => ({ id: "00000000-0000-4000-8000-000000000001" }));
vi.mock("@/modules/projects/projects", () => {
  const saved = async () => PROJECT;
  return {
    setProjectName: saved,
    setProjectStatus: saved,
    setProjectPriority: saved,
    setProjectArea: saved,
    setProjectDates: saved,
    setProjectObjective: saved,
    restoreProjectById: saved,
    reopenProjectById: saved,
    softDeleteProject: saved,
    insertProject: saved,
    insertDependency: async () => "added",
    deleteDependency: async () => true,
  };
});

const id = PROJECT.id;
const other = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

describe("the helpers", () => {
  test("revalidateProjectScreens: the list, the project's page and the home page", () => {
    revalidateProjectScreens(id);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });

  test("revalidateProjectListings: the list and the home page, not the project's page", () => {
    revalidateProjectListings();
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });
});

// Every action whose change can move a project on or off the board, or change its row.
const ACTIONS: [string, () => Promise<{ ok: boolean }>][] = [
  ["changeProjectStatus", () => changeProjectStatus({ id, status: "paused" })],
  ["updateProjectDates", () => updateProjectDates({ id, startDate: null, dueDate: "2026-10-06" })],
  ["changeProjectPriority", () => changeProjectPriority({ id, priority: "high" })],
  ["changeProjectArea", () => changeProjectArea({ id, lifeAreaId: other })],
  ["renameProject", () => renameProject({ id, name: "Otro nombre" })],
  ["addDependency", () => addDependency({ id, blockedById: other })],
  ["removeDependency", () => removeDependency({ id, blockedById: other })],
  ["closeProject", () => closeProject({ id, status: "done" })],
  ["reopenProject", () => reopenProject({ id })],
  ["restoreProject", () => restoreProject({ id })],
  ["deleteProject", () => deleteProject({ id })],
];

test.each(ACTIONS)("%s revalidates the home page", async (_name, run) => {
  const result = await run();
  expect(result.ok).toBe(true);
  expect(revalidatePath).toHaveBeenCalledWith("/");
});

test("deleting revalidates the list and the home page, never the deleted project's page", async () => {
  await deleteProject({ id });
  expect(revalidatePath).not.toHaveBeenCalledWith(`/projects/${id}`);
  expect(revalidatePath).toHaveBeenCalledWith("/projects");
});
