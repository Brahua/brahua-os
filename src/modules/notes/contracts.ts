// What `notes` offers the rest of the app (SPEC-notes "Contratos"). Only the composition roots in
// src/lib read it (eslint.config.mjs: no module imports `notes`). Server only.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import type { NoteLinkType } from "@/lib/markdown/note-links";
import { ownerDateKey } from "@/lib/time";
import { selectLinkingNotes, type LinkingNote } from "./links";
import { selectDayHasText } from "./notes";

export type { LinkingNote } from "./links";

/** What Hoy's key needs: whether today's note (Lima's day of `now`) already has text. */
export type TodayNoteState = { day: string; hasText: boolean };

/**
 * Today's note for the key on Hoy: «Nota de hoy», or «Seguir la nota de hoy» when it has text.
 * One query.
 */
export async function getTodayNoteState(now: Date): Promise<TodayNoteState> {
  await requireOwner();
  const day = ownerDateKey(now);
  return { day, hasText: await selectDayHasText(getDb(), day) };
}

// ---------------------------------------------------------------------------------------------
// Link sources (SPEC-notes "Fuentes de enlace", N2).

/** A result of the `[[` picker. `hint`: a short state («Hecha», «Archivado»…), or none. */
export type NoteLinkCandidate = { id: string; name: string; hint?: string | null };

/** What a link points to now. `deleted`: soft-deleted (drawn as «Nombre (eliminado)»). */
export type NoteLinkTarget = {
  id: string;
  name: string;
  /** The entity's page, built from its id (never from a note's text). */
  href: string;
  deleted: boolean;
  /** Tasks only (N3's live checkbox). */
  done?: boolean;
};

/**
 * One module's side of the `[[` links. Each module exports plain data functions (its
 * `note-link-source.ts`, which never imports `notes`); src/lib/note-link-sources.ts puts them in
 * this shape. Both functions take the database and trust their input: the caller checked the owner.
 */
export type NoteLinkSource = {
  type: NoteLinkType;
  /** The group's name in the picker (UI copy): «Proyectos». */
  label: string;
  /** Live rows whose name contains `q` (no accents or case), best first, at most `limit`. */
  search(db: Database, q: string, limit: number): Promise<NoteLinkCandidate[]>;
  /** The rows behind `ids`, deleted ones included (marked). Unknown ids are simply missing. */
  resolve(db: Database, ids: readonly string[]): Promise<NoteLinkTarget[]>;
};

/** The picker's results, grouped by type in the sources' order. */
export type NoteLinkGroup = {
  type: NoteLinkType;
  label: string;
  items: { id: string; name: string; hint: string | null }[];
};

/**
 * «Mencionado en N notas» on an entity's page (SPEC-notes "Backlinks"): the live notes that link to
 * it, most recently edited first. One query.
 */
export async function getNoteMentions(type: NoteLinkType, id: string): Promise<LinkingNote[]> {
  await requireOwner();
  return selectLinkingNotes(getDb(), type, id, ownerDateKey(new Date()));
}
