import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { afterEach, vi } from "vitest";

// jsdom has no matchMedia. Components read queries (desktop width, reduced motion); by default
// none matches (a phone, motion allowed). That default can hide a test that forgot to say what
// it needs, so it warns once per query and file: a test that cares assigns its own
// `window.matchMedia` (and then this is never called).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  const warned = new Set<string>();
  window.matchMedia = ((query: string) => {
    if (!warned.has(query)) {
      warned.add(query);
      console.warn(
        `[tests/setup] window.matchMedia("${query}") answered with the default (no match). ` +
          "Assign window.matchMedia in the test if the answer matters.",
      );
    }
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

// NumberFlow draws its digits in a custom element that jsdom does not run: tests see the figure
// with its prefix and suffix. A test file may mock it again with its own version.
vi.mock("@number-flow/react", () => ({
  default: ({ value, prefix, suffix }: { value: number; prefix?: string; suffix?: string }) =>
    createElement(Fragment, null, `${prefix ?? ""}${value}${suffix ?? ""}`),
}));

afterEach(() => {
  cleanup();
});
