import { beforeEach, expect, test, vi } from "vitest";
import DesignGuidePage from "@/app/(app)/design/page";
import { requireOwner } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));

beforeEach(() => {
  vi.mocked(requireOwner).mockReset();
});

test("design guide is only rendered for the owner", async () => {
  await expect(DesignGuidePage()).resolves.toBeTruthy();
  expect(requireOwner).toHaveBeenCalled();
});

test("design guide does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(DesignGuidePage()).rejects.toThrow("NEXT_REDIRECT");
});
