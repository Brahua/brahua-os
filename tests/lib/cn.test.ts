import { describe, expect, test } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  test("keeps a design-system font size and text color together", () => {
    expect(cn("text-body text-text")).toBe("text-body text-text");
    expect(cn("text-label text-text-secondary")).toBe("text-label text-text-secondary");
  });

  test("later font size wins over an earlier one", () => {
    expect(cn("text-body", "text-heading")).toBe("text-heading");
  });

  test("later semantic color wins over an earlier one", () => {
    expect(cn("bg-surface", "bg-key")).toBe("bg-key");
  });

  test("custom shadows and easings merge by group", () => {
    expect(cn("shadow-key", "shadow-key-pressed")).toBe("shadow-key-pressed");
    expect(cn("ease-press", "ease-drawer")).toBe("ease-drawer");
  });

  test("keeps design-system component classes untouched", () => {
    expect(cn("bo-key", "bo-key--signal", false, "bo-key--lg")).toBe(
      "bo-key bo-key--signal bo-key--lg",
    );
  });
});
