// A change to a habit revalidates /habits and the home page, where `today` shows the habits due
// today (SPEC-today "Revalidación"): the board never shows a stale pad after logging elsewhere.
import { revalidatePath } from "next/cache";
import { expect, test, vi } from "vitest";
import { revalidateHabitScreens } from "@/modules/habits/revalidate";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

test("revalidates every page under /habits and the home page", () => {
  revalidateHabitScreens();
  expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledTimes(2);
});
