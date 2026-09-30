// Registry of the app's modules (SPEC-core "Convención de módulos"). Navigation is built from
// here: adding a module means creating src/modules/<id>/module.ts and listing it in MODULES,
// without touching the layout.
//
// Manifests must stay client-safe: plain data plus a Lucide icon. The navigation is a Client
// Component that imports this registry, so a manifest must never import server-only code
// (database, auth, `server-only` modules) or it ends up in the browser bundle.
import type { LucideIcon } from "lucide-react";
import { areasModule, homeModule, settingsModule } from "@/modules/core/module";

/** Number keys 1–8 (SPEC-design-system "Atajos de teclado"). */
export type NavShortcutKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ModuleManifest = {
  /** Stable id, in English (e.g. "projects"). */
  id: string;
  /** User-facing name, in Spanish. */
  label: string;
  icon: LucideIcon;
  /** Route the module lives under. Unique across modules. */
  href: string;
  /** Position in the navigation, ascending. Leave gaps (10, 20, 30…) to insert modules later. */
  navOrder: number;
  /**
   * Sidebar group: `main` modules go on top; `footer` ones (Áreas, Ajustes) are pinned to the
   * bottom of the sidebar. Default `main`.
   */
  navGroup?: "main" | "footer";
  /**
   * Fixed number key (1–8). Fixed per module, so numbers don't shift as other modules become
   * available (the design sets Hoy = 1, Áreas = 7, Ajustes = 8). Without it: no shortcut.
   */
  shortcut?: NavShortcutKey;
  /** `planned`: declared ahead of time but not built yet, so it stays out of the navigation. */
  status?: "available" | "planned";
};

/** Every module the app knows about, available or planned. Order does not matter here. */
export const MODULES: readonly ModuleManifest[] = [homeModule, areasModule, settingsModule];

/** Phone bottom bar: at most 5 cells, and the center one is the capture key. */
export const BOTTOM_NAV_SLOTS = 4;

export type NavItem = Pick<ModuleManifest, "id" | "label" | "icon" | "href"> & {
  group: "main" | "footer";
  /** "1"–"8" when the module declares a number key. */
  shortcut?: string;
};

function assertValidRegistry(modules: readonly ModuleManifest[]) {
  const seen = { id: new Set<string>(), href: new Set<string>(), shortcut: new Set<number>() };
  for (const manifest of modules) {
    if (seen.id.has(manifest.id)) throw new Error(`Duplicate module id: ${manifest.id}`);
    if (seen.href.has(manifest.href)) throw new Error(`Duplicate module href: ${manifest.href}`);
    seen.id.add(manifest.id);
    seen.href.add(manifest.href);
    if (manifest.shortcut === undefined) continue;
    if (!Number.isInteger(manifest.shortcut) || manifest.shortcut < 1 || manifest.shortcut > 8) {
      throw new Error(`Invalid shortcut for ${manifest.id}: ${manifest.shortcut}`);
    }
    if (seen.shortcut.has(manifest.shortcut)) {
      throw new Error(`Duplicate module shortcut: ${manifest.shortcut}`);
    }
    seen.shortcut.add(manifest.shortcut);
  }
}

/**
 * Navigable modules in navigation order: `main` first, then `footer`, each by `navOrder`.
 * Planned modules are left out. Throws on duplicate ids, hrefs or shortcuts.
 */
export function navItems(modules: readonly ModuleManifest[] = MODULES): NavItem[] {
  assertValidRegistry(modules);
  const groupRank = (manifest: ModuleManifest) => (manifest.navGroup === "footer" ? 1 : 0);
  return modules
    .filter((manifest) => (manifest.status ?? "available") === "available")
    .sort((a, b) => groupRank(a) - groupRank(b) || a.navOrder - b.navOrder)
    .map((manifest) => ({
      id: manifest.id,
      label: manifest.label,
      icon: manifest.icon,
      href: manifest.href,
      group: manifest.navGroup ?? "main",
      shortcut: manifest.shortcut === undefined ? undefined : String(manifest.shortcut),
    }));
}

/** The navigable item bound to number key `digit` (1–8), if any. */
export function itemForShortcut(items: readonly NavItem[], digit: number): NavItem | undefined {
  return items.find((item) => item.shortcut === String(digit));
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
