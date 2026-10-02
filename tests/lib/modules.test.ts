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

  test("Hoy (1), Proyectos (2), Tareas (3), Hábitos (4), Áreas (footer, 7) and Ajustes (footer, 8) are navigable; none is planned", () => {
    expect(navItems().map((item) => [item.label, item.href, item.group, item.shortcut])).toEqual([
      ["Hoy", "/", "main", "1"],
      ["Proyectos", "/projects", "main", "2"],
      ["Tareas", "/tasks", "main", "3"],
      ["Hábitos", "/habits", "main", "4"],
      ["Áreas", "/areas", "footer", "7"],
      ["Ajustes", "/settings", "footer", "8"],
    ]);
    expect(MODULES.filter((entry) => entry.status === "planned")).toEqual([]);
  });

  test("on the phone, Hábitos takes the cell after the capture key; Tareas, Áreas and Ajustes go under Más", () => {
    const { primary, overflow } = splitBottomNav(navItems());
    // Cells 1, 2 and 4 (the capture key is cell 3), then "Más" in cell 5 (SPEC-habits).
    expect(primary.map((item) => item.label)).toEqual(["Hoy", "Proyectos", "Hábitos"]);
    expect(overflow.map((item) => item.label)).toEqual(["Tareas", "Áreas", "Ajustes"]);
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

  test("bottomNavOrder reorders the bar only (main before footer still); ties keep the order", () => {
    const items = navItems([
      manifest("today", { navOrder: 10 }),
      manifest("tasks", { navOrder: 30 }),
      manifest("habits", { navOrder: 40, bottomNavOrder: 25 }),
      manifest("projects", { navOrder: 20 }),
      manifest("areas", { navOrder: 10, navGroup: "footer", bottomNavOrder: 0 }),
    ]);
    // The sidebar keeps navOrder.
    expect(items.map((item) => item.id)).toEqual(["today", "projects", "tasks", "habits", "areas"]);
    const { primary, overflow } = splitBottomNav(items);
    expect(primary.map((item) => item.id)).toEqual(["today", "projects", "habits"]);
    expect(overflow.map((item) => item.id)).toEqual(["tasks", "areas"]);
    expect(splitBottomNav(items.slice(0, 4)).primary.map((item) => item.id)).toEqual([
      "today",
      "projects",
      "habits",
      "tasks",
    ]);
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
