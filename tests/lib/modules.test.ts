import { Circle } from "lucide-react";
import { describe, expect, test } from "vitest";
import {
  isActiveHref,
  itemForShortcut,
  MODULES,
  navItems,
  splitBottomNav,
  type ModuleManifest,
  type NavItem,
} from "@/lib/modules";

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { id, label: id, icon: Circle, href: `/${id}`, navOrder: 10, ...extra };
}

describe("registry", () => {
  test("every module has a unique id and href, an absolute href and a label", () => {
    expect(() => navItems(MODULES)).not.toThrow();
    for (const entry of MODULES) {
      expect(entry.href).toMatch(/^\//);
      expect(entry.label.trim()).not.toBe("");
    }
  });

  test("today only Hoy is navigable; Áreas and Ajustes are declared as planned", () => {
    expect(navItems().map((item) => [item.label, item.href, item.shortcut])).toEqual([
      ["Hoy", "/", "1"],
    ]);
    expect(
      MODULES.filter((entry) => entry.status === "planned").map((entry) => [
        entry.label,
        entry.shortcut,
      ]),
    ).toEqual([
      ["Áreas", 7],
      ["Ajustes", 8],
    ]);
  });
});

describe("navItems", () => {
  test("orders main modules first, then footer ones, each by navOrder", () => {
    const items = navItems([
      manifest("settings", { navOrder: 20, navGroup: "footer" }),
      manifest("habits", { navOrder: 30 }),
      manifest("areas", { navOrder: 10, navGroup: "footer" }),
      manifest("today", { navOrder: 10 }),
      manifest("projects", { navOrder: 20 }),
    ]);
    expect(items.map((item) => [item.id, item.group])).toEqual([
      ["today", "main"],
      ["projects", "main"],
      ["habits", "main"],
      ["areas", "footer"],
      ["settings", "footer"],
    ]);
  });

  test("shortcuts are fixed per module: they don't shift when others are planned", () => {
    const items = navItems([
      manifest("today", { navOrder: 10, shortcut: 1 }),
      manifest("projects", { navOrder: 20, shortcut: 2, status: "planned" }),
      manifest("habits", { navOrder: 30, shortcut: 3, status: "available" }),
      manifest("notes", { navOrder: 40 }),
      manifest("settings", { navOrder: 10, navGroup: "footer", shortcut: 8 }),
    ]);
    expect(items.map((item) => [item.id, item.shortcut])).toEqual([
      ["today", "1"],
      ["habits", "3"],
      ["notes", undefined],
      ["settings", "8"],
    ]);
    expect(itemForShortcut(items, 8)?.id).toBe("settings");
    expect(itemForShortcut(items, 2)).toBeUndefined();
  });

  test("rejects duplicate ids, hrefs and shortcuts, and shortcuts outside 1–8", () => {
    expect(() => navItems([manifest("today"), manifest("today")])).toThrow(/Duplicate module id/);
    expect(() => navItems([manifest("a", { href: "/x" }), manifest("b", { href: "/x" })])).toThrow(
      /Duplicate module href/,
    );
    expect(() =>
      navItems([manifest("a", { shortcut: 2 }), manifest("b", { shortcut: 2, status: "planned" })]),
    ).toThrow(/Duplicate module shortcut/);
    expect(() => navItems([manifest("a", { shortcut: 9 as never })])).toThrow(/Invalid shortcut/);
  });
});

describe("splitBottomNav", () => {
  const items = (n: number): NavItem[] =>
    navItems(Array.from({ length: n }, (_, i) => manifest(`m${i}`, { navOrder: i })));

  test("up to 4 items all fit next to the capture key", () => {
    expect(splitBottomNav(items(1))).toEqual({ primary: items(1), overflow: [] });
    expect(splitBottomNav(items(4)).primary).toHaveLength(4);
    expect(splitBottomNav(items(4)).overflow).toEqual([]);
  });

  test("with more than 4, the first 3 stay and the rest go under Más", () => {
    const { primary, overflow } = splitBottomNav(items(6));
    expect(primary.map((item) => item.id)).toEqual(["m0", "m1", "m2"]);
    expect(overflow.map((item) => item.id)).toEqual(["m3", "m4", "m5"]);
  });
});

describe("isActiveHref", () => {
  test.each([
    ["/", "/", true],
    ["/", "/design", false],
    ["/areas", "/areas", true],
    ["/areas", "/areas/123", true],
    ["/areas", "/areasx", false],
    ["/areas", "/", false],
  ])("%s is active on %s: %s", (href, pathname, active) => {
    expect(isActiveHref(href, pathname)).toBe(active);
  });
});
