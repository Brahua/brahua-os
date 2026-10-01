// Notes data access (server only, P5). Callers check the owner and validate first.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { projects } from "./db/schema";

/**
 * Writes a project's notes (null clears them). Returns the notes as saved, or `undefined`
 * (writing nothing) when the project doesn't exist or is deleted.
 */
export async function setProjectNotes(
  db: Database,
  id: string,
  notes: string | null,
): Promise<{ notes: string | null } | undefined> {
  const [project] = await db
    .update(projects)
    .set({ notes })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .returning({ notes: projects.notes });
  return project;
}
