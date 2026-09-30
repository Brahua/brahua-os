// Registry of the app's modules (SPEC-core "Convención de módulos"). Navigation is built from
// here: adding a module means creating src/modules/<id>/module.ts and listing it in MODULES,
// without touching the layout.
import type { LucideIcon } from "lucide-react";
import { areasModule, homeModule, settingsModule } from "@/modules/core/module";

export type ModuleManifest = {
  /** Stable id, in English (e.g. "projects"). */
  id: string;
  /** User-facing name, in Spanish. */
  label: string;
  icon: LucideIcon;
  /** Route the module lives under. */
  href: string;
  /** Position in the navigation, ascending. Leave gaps (10, 20, 30…) to insert modules later. */
  navOrder: number;
  /**
   * Sidebar group: `main` modules go on top; `footer` ones (Áreas, Ajustes) are pinned to the
   * bottom of the sidebar. Default `main`.
   */
  navGroup?: "main" | "footer";
  /** `planned`: declared ahead of time but not built yet, so it stays out of the navigation. */
  status?: "available" | "planned";
};

/** Every module the app knows about, available or planned. Order does not matter here. */
export const MODULES: readonly ModuleManifest[] = [homeModule, areasModule, settingsModule];

/** The sidebar has number shortcuts 1–8 (SPEC-design-system "Atajos de teclado"). */
export const MAX_SHORTCUTS = 8;
/** Phone bottom bar: at most 5 cells, and the center one is the capture key. */
export const BOTTOM_NAV_SLOTS = 4;

export type NavItem = Pick<ModuleManifest, "id" | "label" | "icon" | "href"> & {
  group: "main" | "footer";
  /** "1"–"8" for the first eight items, in navigation order. */
  shortcut?: string;
};

/**
 * Navigable modules in navigation order: `main` first, then `footer`, each by `navOrder`.
 * Planned modules are left out. Shortcuts follow this order, so "1" is always the first item.
 */
export function navItems(modules: readonly ModuleManifest[] = MODULES): NavItem[] {
  const ids = new Set<string>();
  for (const manifest of modules) {
    if (ids.has(manifest.id)) throw new Error(`Duplicate module id: ${manifest.id}`);
    ids.add(manifest.id);
  }

  const groupRank = (manifest: ModuleManifest) => (manifest.navGroup === "footer" ? 1 : 0);
  return modules
    .filter((manifest) => (manifest.status ?? "available") === "available")
    .sort((a, b) => groupRank(a) - groupRank(b) || a.navOrder - b.navOrder)
    .map((manifest, index) => ({
      id: manifest.id,
      label: manifest.label,
      icon: manifest.icon,
      href: manifest.href,
      group: manifest.navGroup ?? "main",
      shortcut: index < MAX_SHORTCUTS ? String(index + 1) : undefined,
    }));
}

/**
 * Splits the items for the phone bottom bar: up to 4 fit next to the capture key; with more,
 * the first 3 stay and the rest go under "Más" (SPEC-core).
 */
export function splitBottomNav(items: readonly NavItem[]): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  if (items.length <= BOTTOM_NAV_SLOTS) return { primary: [...items], overflow: [] };
  return {
    primary: items.slice(0, BOTTOM_NAV_SLOTS - 1),
    overflow: items.slice(BOTTOM_NAV_SLOTS - 1),
  };
}

/** Whether `href` is the current section: exact match, or a sub-route (`/areas/x` → `/areas`). */
export function isActiveHref(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
