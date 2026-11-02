// L3 of `learning`: a change revalidates /learning and what shows tracks elsewhere: Hoy («Estudio»)
// and the projects (a linked track counts in their progress).
import { revalidatePath } from "next/cache";
import { expect, test, vi } from "vitest";
import { revalidateLearning } from "@/modules/learning/revalidate";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

test("revalidates /learning, / and the projects", () => {
  revalidateLearning();
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([
    ["/learning", "layout"],
    ["/"],
    ["/projects", "layout"],
  ]);
});
