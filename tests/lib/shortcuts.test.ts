import { describe, expect, test } from "vitest";
import { isShortcutFreeTarget, navShortcutFor } from "@/lib/shortcuts";

type Init = Partial<Parameters<typeof navShortcutFor>[0]> & { altGraph?: boolean };

function press(key: string, init: Init = {}) {
  const { altGraph = false, ...rest } = init;
  return navShortcutFor({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: document.body,
    getModifierState: (name) => name === "AltGraph" && altGraph,
    ...rest,
  });
}

function element(html: string, selector: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector(selector)!;
}

describe("navShortcutFor", () => {
  test("[ toggles the sidebar", () => {
    expect(press("[")).toEqual({ type: "toggle-sidebar" });
  });

  test("1–8 go to the Nth item; 0 and 9 do nothing", () => {
    expect(press("1")).toEqual({ type: "go", index: 0 });
    expect(press("8")).toEqual({ type: "go", index: 7 });
    expect(press("0")).toBeNull();
    expect(press("9")).toBeNull();
    expect(press("a")).toBeNull();
  });

  test("ignores ⌘, Ctrl, ⌥ and Shift combinations", () => {
    expect(press("1", { metaKey: true })).toBeNull();
    expect(press("1", { ctrlKey: true })).toBeNull();
    expect(press("1", { altKey: true })).toBeNull();
    expect(press("1", { shiftKey: true })).toBeNull();
    expect(press("[", { metaKey: true })).toBeNull();
    expect(press("[", { ctrlKey: true })).toBeNull();
  });

  test("accepts [ typed with ⌥ or AltGr (Spanish and Latin American layouts)", () => {
    expect(press("[", { altKey: true })).toEqual({ type: "toggle-sidebar" });
    // Windows reports AltGr as Ctrl + Alt.
    expect(press("[", { altKey: true, ctrlKey: true, altGraph: true })).toEqual({
      type: "toggle-sidebar",
    });
    expect(press("1", { altKey: true, ctrlKey: true, altGraph: true })).toBeNull();
  });

  test("ignores auto-repeat, IME composition and handled events", () => {
    expect(press("[", { repeat: true })).toBeNull();
    expect(press("1", { isComposing: true })).toBeNull();
    expect(press("1", { defaultPrevented: true })).toBeNull();
  });

  test.each([
    ['<input type="text">', "input"],
    ["<textarea></textarea>", "textarea"],
    ["<select><option>a</option></select>", "select"],
    ['<div contenteditable="true"><p>texto</p></div>', "p"],
    ['<div role="textbox"></div>', "div"],
    ['<div role="dialog"><button>ok</button></div>', "button"],
  ])("ignores key presses inside %s", (html, selector) => {
    const target = element(html, selector);
    expect(press("1", { target })).toBeNull();
    expect(press("[", { target })).toBeNull();
  });
});

describe("isShortcutFreeTarget", () => {
  test("buttons, links and the page itself take shortcuts", () => {
    expect(isShortcutFreeTarget(element("<button>x</button>", "button"))).toBe(false);
    expect(isShortcutFreeTarget(element('<a href="/">x</a>', "a"))).toBe(false);
    expect(isShortcutFreeTarget(document.body)).toBe(false);
    expect(isShortcutFreeTarget(null)).toBe(false);
    expect(isShortcutFreeTarget(window)).toBe(false);
  });

  test('contenteditable="false" is not text entry', () => {
    expect(isShortcutFreeTarget(element('<div contenteditable="false">x</div>', "div"))).toBe(
      false,
    );
  });
});
