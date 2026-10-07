import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => {
  cleanup();
});
