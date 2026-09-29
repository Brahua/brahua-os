import { afterEach, expect, test, vi } from "vitest";
import DesignGuidePage from "@/app/(dev)/design/page";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("design guide is not available in production builds by default", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DESIGN_GUIDE", "");
  expect(() => DesignGuidePage()).toThrow();
});

test("design guide renders in production when explicitly enabled", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DESIGN_GUIDE", "enabled");
  expect(() => DesignGuidePage()).not.toThrow();
});
