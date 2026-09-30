// Seeds the 8 default life areas. Idempotent: existing slugs are left untouched.
//   DATABASE_URL_UNPOOLED=… pnpm db:seed
import { pathToFileURL } from "node:url";
import { AREA_COLORS, DEFAULT_AREAS } from "@/design-system";
import { createDb, type Database } from "@/lib/db";
import { lifeAreas, type NewLifeArea } from "@/modules/core/db/schema";

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

export async function seed(db: Database): Promise<number> {
  const inserted = await db
    .insert(lifeAreas)
    .values(DEFAULT_LIFE_AREAS)
    .onConflictDoNothing({ target: lifeAreas.slug })
    .returning({ id: lifeAreas.id });
  return inserted.length;
}

async function main() {
  // No silent default: the target database must be named explicitly.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL_UNPOOLED or DATABASE_URL explicitly to seed a database.");
    process.exit(1);
  }
  const db = createDb(url);
  try {
    const count = await seed(db);
    console.log(`Seeded ${count} new life area(s).`);
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
