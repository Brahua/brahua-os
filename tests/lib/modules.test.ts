import { Circle } from "lucide-react";
import { describe, expect, test } from "vitest";
import {
  isActiveHref,
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
  test("every module has a unique id, an absolute href and a label", () => {
    const ids = MODULES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
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
      MODULES.filter((entry) => entry.status === "planned").map((entry) => entry.label),
    ).toEqual(["Áreas", "Ajustes"]);
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
    expect(items.map((item) => [item.id, item.group, item.shortcut])).toEqual([
      ["today", "main", "1"],
      ["projects", "main", "2"],
      ["habits", "main", "3"],
      ["areas", "footer", "4"],
      ["settings", "footer", "5"],
    ]);
  });

  test("leaves planned modules out and numbers only what is shown", () => {
    const items = navItems([
      manifest("today", { navOrder: 10 }),
      manifest("projects", { navOrder: 20, status: "planned" }),
      manifest("habits", { navOrder: 30, status: "available" }),
    ]);
    expect(items.map((item) => [item.id, item.shortcut])).toEqual([
      ["today", "1"],
      ["habits", "2"],
    ]);
  });

  test("only the first eight items get a number shortcut", () => {
    const items = navItems(
      Array.from({ length: 10 }, (_, i) => manifest(`m${i}`, { navOrder: i })),
    );
    expect(items.map((item) => item.shortcut)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      undefined,
      undefined,
    ]);
  });

  test("rejects duplicate ids", () => {
    expect(() => navItems([manifest("today"), manifest("today")])).toThrow(/Duplicate/);
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
