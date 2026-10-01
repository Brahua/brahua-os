// The 8 default life areas (SPEC-core "Seed inicial"). Used by `pnpm db:seed` (scripts/seed.ts),
// which runs on every production build, and by the E2E setup.
import { AREA_COLORS, DEFAULT_AREAS } from "@/design-system/areas";
import type { Database } from "@/lib/db";
import { lifeAreas, type NewLifeArea } from "./db/schema";

/** Spanish names from SPEC-core (the design system's labels are shorter for some areas). */
const AREA_NAMES: Record<(typeof AREA_COLORS)[number], string> = {
  home: "Hogar",
  health: "Salud y Bienestar",
  finance: "Finanzas e Inversiones",
  learning: "Aprendizaje y Desarrollo profesional",
  work: "Trabajo",
  relationships: "Relaciones y Familia",
  travel: "Planes y Viajes",
  hobbies: "Hobbies",
};

export const DEFAULT_LIFE_AREAS: NewLifeArea[] = AREA_COLORS.map((slug, index) => ({
  slug,
  name: AREA_NAMES[slug],
  color: slug,
  icon: DEFAULT_AREAS[slug].icon,
  sortOrder: index,
}));

/** Inserts the default areas whose slug is missing. Idempotent; never overwrites. */
export async function seed(db: Database): Promise<number> {
  const inserted = await db
    .insert(lifeAreas)
    .values(DEFAULT_LIFE_AREAS)
    .onConflictDoNothing({ target: lifeAreas.slug })
    .returning({ id: lifeAreas.id });
  return inserted.length;
}
