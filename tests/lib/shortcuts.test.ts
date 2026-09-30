import { describe, expect, test } from "vitest";
import { isShortcutFreeTarget, navShortcutFor } from "@/lib/shortcuts";

type Init = Partial<Parameters<typeof navShortcutFor>[0]> & { altGraph?: boolean };

function press(key: string, init: Init = {}) {
  const { altGraph = false, ...rest } = init;
  return navShortcutFor({
    key,
    code: /^\d$/.test(key) ? `Digit${key}` : "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: document.body,
    getModifierState: (name: string) => name === "AltGraph" && altGraph,
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

  test("1–8 go to that number; 0 and 9 do nothing", () => {
    expect(press("1")).toEqual({ type: "go", digit: 1 });
    expect(press("8")).toEqual({ type: "go", digit: 8 });
    expect(press("0")).toBeNull();
    expect(press("9")).toBeNull();
    expect(press("a")).toBeNull();
  });

  test("⌥ + digit works too, matched by the physical key", () => {
    // On a Mac, ⌥1 types "¡": the key changes, the code doesn't.
    expect(press("¡", { altKey: true, code: "Digit1" })).toEqual({ type: "go", digit: 1 });
    expect(press("7", { altKey: true, code: "Digit7" })).toEqual({ type: "go", digit: 7 });
    expect(press("9", { altKey: true, code: "Digit9" })).toBeNull();
    expect(press("1", { altKey: true, code: "Numpad1" })).toBeNull();
  });

  test("ignores ⌘, Ctrl and Shift combinations", () => {
    expect(press("1", { metaKey: true })).toBeNull();
    expect(press("1", { ctrlKey: true })).toBeNull();
    expect(press("1", { shiftKey: true })).toBeNull();
    expect(press("1", { altKey: true, shiftKey: true })).toBeNull();
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
    ["<input>", "input"],
    ['<input type="search">', "input"],
    ['<input type="number">', "input"],
    ["<textarea></textarea>", "textarea"],
    ["<select><option>a</option></select>", "select"],
    ['<div contenteditable="true"><p>texto</p></div>', "p"],
    ['<div role="textbox"></div>', "div"],
    ['<div role="searchbox"></div>', "div"],
    ['<div role="combobox"></div>', "div"],
    ['<ul role="listbox"><li role="option">a</li></ul>', "li"],
    ['<ul role="menu"><li role="menuitem">a</li></ul>', "li"],
    ['<table role="grid"><tr><td>a</td></tr></table>', "td"],
    ['<ul role="tree"><li role="treeitem">a</li></ul>', "li"],
    ['<div role="slider"></div>', "div"],
    ['<div role="spinbutton"></div>', "div"],
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

  test.each(["checkbox", "radio", "button", "submit", "reset", "range", "CHECKBOX"])(
    'an <input type="%s"> is not text entry',
    (type) => {
      expect(isShortcutFreeTarget(element(`<input type="${type}">`, "input"))).toBe(false);
    },
  );

  test('contenteditable="false" is not text entry', () => {
    expect(isShortcutFreeTarget(element('<div contenteditable="false">x</div>', "div"))).toBe(
      false,
    );
  });
});
