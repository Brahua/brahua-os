// P5: which link clicks the unsaved-changes guard may stop (src/lib/navigation-guard.ts). Only
// a plain left click that opens another page of the app in this tab.
import { afterEach, describe, expect, test } from "vitest";
import { inAppHref } from "@/lib/navigation-guard";

function anchor(href: string, attributes: Record<string, string> = {}) {
  const element = document.createElement("a");
  element.href = href;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

const click = (init: MouseEventInit = {}) =>
  new MouseEvent("click", { button: 0, bubbles: true, cancelable: true, ...init });

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/projects/1");
});

describe("inAppHref", () => {
  test("a plain click on a page of the app: its path", () => {
    window.history.replaceState(null, "", "/projects/1");
    expect(inAppHref(click(), anchor("/projects?area=home"))).toBe("/projects?area=home");
    expect(inAppHref(click(), anchor("/areas#top"))).toBe("/areas#top");
  });

  test.each([
    ["⌘-click", { metaKey: true }],
    ["Ctrl-click", { ctrlKey: true }],
    ["Shift-click", { shiftKey: true }],
    ["Alt-click", { altKey: true }],
    ["middle click", { button: 1 }],
  ])("%s opens elsewhere: never stopped", (_name, init) => {
    expect(inAppHref(click(init), anchor("/areas"))).toBeNull();
  });

  test("a click something else already handled", () => {
    const event = click();
    event.preventDefault();
    expect(inAppHref(event, anchor("/areas"))).toBeNull();
  });

  test.each([
    ["_blank", { target: "_blank" }],
    ["a named window", { target: "otra" }],
    ["download", { download: "" }],
  ])("%s: never stopped", (_name, attributes) => {
    expect(inAppHref(click(), anchor("/areas", attributes))).toBeNull();
  });

  test("target=_self is still this tab", () => {
    expect(inAppHref(click(), anchor("/areas", { target: "_self" }))).toBe("/areas");
  });

  test("another origin (or scheme) is the browser's job (beforeunload)", () => {
    expect(inAppHref(click(), anchor("https://example.com/areas"))).toBeNull();
    expect(inAppHref(click(), anchor("mailto:yo@example.com"))).toBeNull();
  });

  test("only the fragment changes: same page, nothing is lost", () => {
    window.history.replaceState(null, "", "/projects/1");
    expect(inAppHref(click(), anchor("#user-content-fn-1"))).toBeNull();
    expect(inAppHref(click(), anchor("/projects/1#notas"))).toBeNull();
    // Positive control: another page with a fragment is stopped.
    expect(inAppHref(click(), anchor("/projects/2#notas"))).toBe("/projects/2#notas");
  });
});
