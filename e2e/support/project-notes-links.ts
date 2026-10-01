// Fixtures and helpers for the notes and links spec (P5). Apart from projects.ts so the specs of
// P3–P5, built in parallel, never edit the same file.
import { eq } from "drizzle-orm";
import { createDb, type Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectLinks, projects } from "@/modules/projects/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/**
 * The project whose notes and links the screenshots show (read only: no test edits it). In
 * "Hogar", so it never shows in the list screenshots, without dates (nothing changes by day).
 */
export const NOTES_FIXTURE = {
  name: "Guía de la mudanza",
  areaSlug: "home",
  notes: [
    "# Antes de empacar",
    "",
    "Separar lo que **se dona**, lo que _se vende_ y lo que viaja. ~~Alquilar camión~~ ya está.",
    "",
    "- [x] Pedir cajas en la bodega",
    "- [ ] Etiquetar por cuarto",
    "- [ ] Cortar el cable el día 30",
    "",
    "## Presupuesto",
    "",
    "| Ítem | Costo |",
    "| :-- | --: |",
    "| Mudanza | S/ 1 200 |",
    "| Pintura | S/ 380 |",
    "",
    "> Lo frágil va en el auto, no en el camión.",
    "",
    "Contrato en [la notaría](https://example.com/notaria). Código del portero: `4821`.",
  ].join("\n"),
  links: [
    { url: "https://github.com/brahua/mudanza", label: "Lista compartida" },
    { url: "https://www.example.com/plano-del-depa", label: null },
  ],
} as const;

/** Inserts NOTES_FIXTURE with its notes and links (global-setup, after the areas seed). */
export async function seedNotesLinksFixture(db: Database): Promise<void> {
  const [area] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, NOTES_FIXTURE.areaSlug));
  const [project] = await db
    .insert(projects)
    .values({
      name: NOTES_FIXTURE.name,
      status: "active",
      lifeAreaId: area.id,
      notes: NOTES_FIXTURE.notes,
    })
    .returning({ id: projects.id });
  await db
    .insert(projectLinks)
    .values(
      NOTES_FIXTURE.links.map((link, sortOrder) => ({ projectId: project.id, ...link, sortOrder })),
    );
}

/** Notes and links straight in the database, for a test's own project. */
export async function setNotesAndLinks(
  projectId: string,
  values: { notes?: string; links?: { url: string; label?: string | null }[] },
): Promise<void> {
  const db = createDb(testDatabaseUrl());
  try {
    if (values.notes !== undefined) {
      await db.update(projects).set({ notes: values.notes }).where(eq(projects.id, projectId));
    }
    if (values.links?.length) {
      await db.insert(projectLinks).values(
        values.links.map((link, sortOrder) => ({
          projectId,
          url: link.url,
          label: link.label ?? null,
          sortOrder,
        })),
      );
    }
  } finally {
    await db.$client.end();
  }
}
