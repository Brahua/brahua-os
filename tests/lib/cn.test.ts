import { describe, expect, test } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  test("keeps a custom font size and a custom text color together", () => {
    expect(cn("text-body text-text")).toBe("text-body text-text");
  });

  test("later custom font size wins over an earlier one", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
  });

  test("later semantic color wins over an earlier one", () => {
    expect(cn("bg-surface", "bg-signal")).toBe("bg-signal");
  });

  test("custom shadows, easings and durations merge by group", () => {
    expect(cn("shadow-key", "shadow-key-pressed")).toBe("shadow-key-pressed");
    expect(cn("ease-press", "ease-sheet")).toBe("ease-sheet");
    expect(cn("duration-press", "duration-state")).toBe("duration-state");
  });

  test("ignores falsy values", () => {
    expect(cn("px-4", false, undefined, null, "py-2")).toBe("px-4 py-2");
  });
});
