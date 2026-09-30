"use client";

import {
  FolderKanban,
  LayoutGrid,
  NotebookPen,
  Repeat,
  Settings,
  Sun,
  Target,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { navItems, type ModuleManifest } from "@/lib/modules";
import { BottomNav } from "@/modules/core/components/bottom-nav";
import { Sidebar } from "@/modules/core/components/sidebar";

// The full navigation from the Claude Design reference, as a registry would describe it once
// every module exists. Links point inside this page so trying them doesn't leave the guide.
const DEMO_MODULES: ModuleManifest[] = [
  { id: "today", label: "Hoy", icon: Sun, href: "#navigation-today", navOrder: 10 },
  {
    id: "projects",
    label: "Proyectos",
    icon: FolderKanban,
    href: "#navigation-projects",
    navOrder: 20,
  },
  { id: "habits", label: "Hábitos", icon: Repeat, href: "#navigation-habits", navOrder: 30 },
  { id: "finance", label: "Finanzas", icon: Wallet, href: "#navigation-finance", navOrder: 40 },
  { id: "goals", label: "Metas", icon: Target, href: "#navigation-goals", navOrder: 50 },
  { id: "notes", label: "Notas", icon: NotebookPen, href: "#navigation-notes", navOrder: 60 },
  {
    id: "areas",
    label: "Áreas",
    icon: LayoutGrid,
    href: "#navigation-areas",
    navOrder: 10,
    navGroup: "footer",
  },
  {
    id: "settings",
    label: "Ajustes",
    icon: Settings,
    href: "#navigation-settings",
    navOrder: 20,
    navGroup: "footer",
  },
];
const DEMO_ITEMS = navItems(DEMO_MODULES);
const CURRENT = DEMO_ITEMS[0].href;

export function BottomNavDemo() {
  return (
    <div className="w-full max-w-97.5 rounded-xl border border-divider pt-4">
      <BottomNav items={DEMO_ITEMS} pathname={CURRENT} label="Ejemplo de barra inferior" />
    </div>
  );
}

type SidebarDemoProps = {
  initialCollapsed?: boolean;
  /** Landmark names must be unique on the page, next to the app's own sidebar. */
  name: string;
};

export function SidebarDemo({ initialCollapsed = false, name }: SidebarDemoProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <div className="h-140 rounded-xl border border-divider">
      <Sidebar
        items={DEMO_ITEMS}
        pathname={CURRENT}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
        // The demo keys aren't bound, so no hints (the app's own sidebar shows the real ones).
        shortcuts={false}
        labels={{ main: name, footer: `${name}: secundaria` }}
        className="h-full rounded-xl"
      />
    </div>
  );
}
