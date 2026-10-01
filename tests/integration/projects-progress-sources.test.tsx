// @vitest-environment jsdom
// P6 wired into P3: a progress source registered through the contract adds its counts to the
// milestones' in the list's cards and the detail's meter, rendered from the real pages against
// the throwaway database; with no source registered the progress is the milestones' alone.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import ProjectsPage from "@/app/(app)/projects/page";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { registerProgressSource, type ProgressSource } from "@/modules/projects/contracts";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { testDb } from "./test-db";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
// The owner check has its own tests: here the pages read the real data.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOwner: vi.fn(async () => ({ user: { id: "owner" } })),
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

let removeSource: (() => void) | undefined;

beforeEach(async () => {
  await seed(testDb);
  // jsdom has no matchMedia (the milestones read the reduced-motion preference).
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  removeSource?.();
  removeSource = undefined;
});

/** A project in "Hogar" with `done` of `total` milestones checked. */
async function projectWithMilestones(name: string, done: number, total: number) {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [project] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: area.id, status: "active" })
    .returning();
  if (total > 0) {
    await testDb.insert(projectMilestones).values(
      Array.from({ length: total }, (_, i) => ({
        projectId: project.id,
        title: `Hito ${i + 1}`,
        sortOrder: i,
        doneAt: i < done ? new Date() : null,
      })),
    );
  }
  return project;
}

/** A fake `tasks`: fixed counts by project id, recording what it was asked. */
function fakeTasks(counts: Record<string, { done: number; total: number }>) {
  const asked: string[][] = [];
  const source: ProgressSource = {
    id: "fake-tasks",
    async countsFor(projectIds) {
      asked.push([...projectIds]);
      return new Map(Object.entries(counts).filter(([id]) => projectIds.includes(id)));
    },
  };
  return { source, asked };
}

const listPage = async () => render(await ProjectsPage({ searchParams: Promise.resolve({}) }));

const detailPage = async (id: string) =>
  render(await ProjectPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));

/** "done/total" of a card's progress in the list (null without one), by the project's name. */
function cardProgress(name: string) {
  const card = screen.getByRole("heading", { name }).closest("li") as HTMLElement;
  return card.querySelector("[data-progress]")?.getAttribute("data-progress") ?? null;
}

/** "done/total" of the detail's meter (null without one); its accessible name says the same. */
function detailProgress() {
  return (
    document
      .querySelector("[data-project-progress] [data-progress]")
      ?.getAttribute("data-progress") ?? null
  );
}

describe("list", () => {
  test("with no source, a card's progress is its milestones' (and none without milestones)", async () => {
    await projectWithMilestones("Con hitos", 1, 2);
    await projectWithMilestones("Sin hitos", 0, 0);
    await listPage();
    expect(cardProgress("Con hitos")).toBe("1/2");
    expect(cardProgress("Sin hitos")).toBeNull();
  });

  test("a registered source adds its counts to every card, in one call for the list", async () => {
    const withMilestones = await projectWithMilestones("Con hitos", 1, 2);
    const onlyTasks = await projectWithMilestones("Solo tareas", 0, 0);
    const untouched = await projectWithMilestones("Sin tareas", 1, 4);
    const tasks = fakeTasks({
      [withMilestones.id]: { done: 3, total: 8 },
      [onlyTasks.id]: { done: 1, total: 4 },
    });
    removeSource = registerProgressSource(tasks.source);
    await listPage();
    // 1/2 milestones + 3/8 tasks = 4/10.
    expect(cardProgress("Con hitos")).toBe("4/10");
    expect(cardProgress("Solo tareas")).toBe("1/4");
    expect(cardProgress("Sin tareas")).toBe("1/4");
    expect(tasks.asked).toHaveLength(1);
    expect([...tasks.asked[0]].sort()).toEqual(
      [withMilestones.id, onlyTasks.id, untouched.id].sort(),
    );
  });
});

describe("detail", () => {
  test("with no source, the meter is the milestones'", async () => {
    const project = await projectWithMilestones("Mudanza", 2, 5);
    await detailPage(project.id);
    expect(detailProgress()).toBe("2/5");
  });

  test("a registered source adds its counts to the meter, asked for this project only", async () => {
    const project = await projectWithMilestones("Mudanza", 2, 5);
    const tasks = fakeTasks({ [project.id]: { done: 4, total: 5 } });
    removeSource = registerProgressSource(tasks.source);
    await detailPage(project.id);
    expect(detailProgress()).toBe("6/10");
    expect(tasks.asked).toEqual([[project.id]]);
  });

  test("a source alone gives a meter to a project without milestones", async () => {
    const project = await projectWithMilestones("Solo tareas", 0, 0);
    await detailPage(project.id);
    expect(detailProgress()).toBeNull();
    cleanup();
    removeSource = registerProgressSource(
      fakeTasks({ [project.id]: { done: 1, total: 2 } }).source,
    );
    await detailPage(project.id);
    expect(detailProgress()).toBe("1/2");
  });
});
