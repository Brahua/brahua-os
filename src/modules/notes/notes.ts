// Notes data access (server only, N1). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries with
// requireOwner()).
//
// Locks (CLAUDE.md "Advisory locks"; SPEC-notes "Modelo de datos"), in NOTES_ADVISORY_SPACE (9000):
// - `(9000, hashtext('notes:daily:' || day))` (`lockDay`): the FIRST lock of every write that may
//   create a day's note (its first save; N3's capture) or bring one back (restoring a deleted daily
//   note). Two at once wait for each other: the second sees the first one's row (and answers with
//   a conflict) instead of failing on the partial unique index `notes_daily_day_unique`, which
//   stays the hard guarantee of one live note per day.
// - Saving a note that exists takes no lock: `UPDATE … WHERE id = $id AND version = $v` decides,
//   and the loser reads what is stored (a conflict, never a silent overwrite).
// Rule: an advisory lock is always the first lock of its transaction, never taken after a row lock.
//
// Deleting is a soft delete (`deleted_at`), like everywhere (CLAUDE.md); «Deshacer» clears it.
// `pnpm db:export` keeps deleted rows. Nothing here logs a note's title or body.
import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { notes } from "./db/schema";
import type { NoteFailure } from "./copy";
import { dailyNoteLockKey, NOTES_ADVISORY_SPACE } from "./lock-keys";
import type {
  CreateNoteInput,
  DeletedNote,
  NoteArea,
  NoteItem,
  NoteKindFilter,
  NoteListItem,
  PinNoteInput,
  RenameNoteInput,
  SaveDailyNoteInput,
  SaveNoteInput,
  SaveResult,
  SetNoteAreaInput,
} from "./note-input";
import { excerptOf } from "./note-text";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** One day's lock. Must be the first lock of the transaction (see the header). */
export async function lockDay(tx: Tx, day: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(NOTES_ADVISORY_SPACE))}, hashtext(${dailyNoteLockKey(day)}))`,
  );
}

const live = isNull(notes.deletedAt);

const ITEM = {
  id: notes.id,
  kind: notes.kind,
  day: notes.day,
  title: notes.title,
  body: notes.body,
  version: notes.version,
  pinnedAt: notes.pinnedAt,
  areaId: lifeAreas.id,
  areaName: lifeAreas.name,
  areaColor: lifeAreas.color,
  areaIcon: lifeAreas.icon,
};

type ItemRow = {
  id: string;
  kind: NoteItem["kind"];
  day: string | null;
  title: string | null;
  body: string;
  version: number;
  pinnedAt: Date | null;
  areaId: string | null;
  areaName: string | null;
  areaColor: NoteArea["color"] | null;
  areaIcon: NoteArea["icon"] | null;
};

function toItem(row: ItemRow): NoteItem {
  const area: NoteArea | null =
    row.areaId && row.areaName && row.areaColor && row.areaIcon
      ? { id: row.areaId, name: row.areaName, color: row.areaColor, icon: row.areaIcon }
      : null;
  return {
    id: row.id,
    kind: row.kind,
    day: row.day,
    title: row.title,
    body: row.body,
    version: row.version,
    area,
    pinned: row.pinnedAt !== null,
  };
}

async function selectItem(db: Database | Tx, where: SQL | undefined): Promise<NoteItem | null> {
  const [row] = await db
    .select(ITEM)
    .from(notes)
    .leftJoin(lifeAreas, eq(lifeAreas.id, notes.areaId))
    .where(where)
    .limit(1);
  return row ? toItem(row) : null;
}

/** A day's live note, or null (the page then opens empty, in edit mode). */
export function selectDailyNote(db: Database, day: string): Promise<NoteItem | null> {
  return selectItem(db, and(eq(notes.kind, "daily"), eq(notes.day, day), live));
}

/** A live knowledge note, or null (missing or deleted: the page is a 404). */
export function selectPageNote(db: Database, id: string): Promise<NoteItem | null> {
  return selectItem(db, and(eq(notes.id, id), eq(notes.kind, "page"), live));
}

/**
 * The day of a live daily note by its id, or null. A `[[note:<id>|…]]` link drawn without the
 * server's resolution (the editor's preview) opens `/notes/<id>`, and the page sends it to its day.
 */
export async function selectDailyNoteDay(db: Database, id: string): Promise<string | null> {
  const [row] = await db
    .select({ day: notes.day })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.kind, "daily"), live))
    .limit(1);
  return row?.day ?? null;
}

/** How much of the body the list reads for a row's excerpt (its first lines). */
const EXCERPT_SOURCE_LENGTH = 2_000;

/**
 * The list (SPEC-notes "Lista"): live notes of the kind and area asked for, pinned first, then by
 * last edit; at most `limit`, and whether there are more. An area filter shows only knowledge
 * notes (a daily note has no area).
 */
export async function selectNoteList(
  db: Database,
  { kind, areaId, limit }: { kind: NoteKindFilter; areaId: string | null; limit: number },
): Promise<{ items: NoteListItem[]; more: boolean }> {
  const rows = await db
    .select({
      id: notes.id,
      kind: notes.kind,
      day: notes.day,
      title: notes.title,
      head: sql<string>`left(${notes.body}, ${EXCERPT_SOURCE_LENGTH})`,
      pinnedAt: notes.pinnedAt,
      updatedAt: notes.updatedAt,
      areaName: lifeAreas.name,
    })
    .from(notes)
    .leftJoin(lifeAreas, eq(lifeAreas.id, notes.areaId))
    .where(
      and(
        live,
        kind === "all" ? undefined : eq(notes.kind, kind),
        areaId === null ? undefined : eq(notes.areaId, areaId),
      ),
    )
    .orderBy(sql`${notes.pinnedAt} is null`, desc(notes.updatedAt), asc(notes.id))
    .limit(limit + 1);
  return {
    more: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      kind: row.kind,
      day: row.day,
      title: row.title,
      excerpt: excerptOf(row.head),
      pinned: row.pinnedAt !== null,
      editedOn: ownerDateKey(row.updatedAt),
      areaName: row.areaName,
    })),
  };
}

/** Today's note for Hoy's key: whether it exists with text. */
export async function selectDayHasText(db: Database, day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.kind, "daily"), eq(notes.day, day), live, ne(notes.body, "")))
    .limit(1);
  return row !== undefined;
}

const SAVED = { id: notes.id, body: notes.body, version: notes.version };

/**
 * The first save of a day without a note (SPEC-notes "Unicidad del día"), under the day's lock: an
 * empty body creates nothing (`empty`); a day that got a note meanwhile is a `conflict` with it.
 */
export async function saveDailyNoteBody(
  db: Database,
  { day, body }: SaveDailyNoteInput,
): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    await lockDay(tx, day);
    const [current] = await tx
      .select(SAVED)
      .from(notes)
      .where(and(eq(notes.kind, "daily"), eq(notes.day, day), live))
      .limit(1);
    if (current) return { status: "conflict", current };
    if (body === "") return { status: "empty" };
    const [created] = await tx.insert(notes).values({ kind: "daily", day, body }).returning(SAVED);
    return { status: "saved", ...created };
  });
}

/**
 * Saves a note's body if it still has the version that was edited, and bumps it. Another version
 * is a `conflict` with what is stored; a deleted or missing note is `notFound`.
 */
export async function saveNoteBody(
  db: Database,
  { id, body, version }: SaveNoteInput,
): Promise<SaveResult | "notFound"> {
  const [saved] = await db
    .update(notes)
    .set({ body, version: sql`${notes.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(notes.id, id), live, eq(notes.version, version)))
    .returning(SAVED);
  if (saved) return { status: "saved", ...saved };
  const [current] = await db
    .select(SAVED)
    .from(notes)
    .where(and(eq(notes.id, id), live))
    .limit(1);
  return current ? { status: "conflict", current } : "notFound";
}

/** Whether `areaId` is an active life area (read FOR SHARE: it can't be archived meanwhile). */
async function areaIsActive(tx: Tx, areaId: string): Promise<boolean> {
  const [area] = await tx
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(and(eq(lifeAreas.id, areaId), isNull(lifeAreas.archivedAt)))
    .for("share");
  return area !== undefined;
}

/** «Nueva nota»: a knowledge note with its title and area, empty. */
export async function insertPageNote(
  db: Database,
  { title, areaId }: CreateNoteInput,
): Promise<{ id: string } | NoteFailure> {
  return db.transaction(async (tx) => {
    if (areaId !== null && !(await areaIsActive(tx, areaId))) return "areaUnavailable";
    const [created] = await tx
      .insert(notes)
      .values({ kind: "page", title, areaId })
      .returning({ id: notes.id });
    return created;
  });
}

const livePage = (id: string) => and(eq(notes.id, id), eq(notes.kind, "page"), live);

/** A knowledge note's new title. The body's version doesn't change (titles never conflict). */
export async function renamePageNote(
  db: Database,
  { id, title }: RenameNoteInput,
): Promise<NoteItem | NoteFailure> {
  const [row] = await db
    .update(notes)
    .set({ title, updatedAt: sql`now()` })
    .where(livePage(id))
    .returning({ id: notes.id });
  if (!row) return "notFound";
  return (await selectItem(db, eq(notes.id, id))) ?? "notFound";
}

/**
 * A knowledge note's area (null: none). The area must be active, unless it is the one the note
 * already has (archived since: keeping it is not a change).
 */
export async function setPageNoteArea(
  db: Database,
  { id, areaId }: SetNoteAreaInput,
): Promise<NoteItem | NoteFailure> {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({ areaId: notes.areaId })
      .from(notes)
      .where(livePage(id))
      .for("update");
    if (!note) return "notFound";
    if (areaId !== null && areaId !== note.areaId && !(await areaIsActive(tx, areaId))) {
      return "areaUnavailable";
    }
    await tx.update(notes).set({ areaId }).where(eq(notes.id, id));
    return (await selectItem(tx, eq(notes.id, id))) ?? "notFound";
  });
}

/** «Fijar» / «Quitar de fijadas». Pinning a pinned note keeps its first pin time. */
export async function setPageNotePinned(
  db: Database,
  { id, pinned }: PinNoteInput,
): Promise<NoteItem | NoteFailure> {
  const [row] = await db
    .update(notes)
    .set({ pinnedAt: pinned ? sql`coalesce(${notes.pinnedAt}, now())` : null })
    .where(livePage(id))
    .returning({ id: notes.id });
  if (!row) return "notFound";
  return (await selectItem(db, eq(notes.id, id))) ?? "notFound";
}

const DELETED = { id: notes.id, kind: notes.kind, day: notes.day, title: notes.title };

/** Soft delete (with «Deshacer»). A note already deleted or missing is `notFound`. */
export async function softDeleteNote(db: Database, id: string): Promise<DeletedNote | NoteFailure> {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(notes.id, id), live))
    .returning(DELETED);
  return row ?? "notFound";
}

/** A deleted note (`?deleted=<id>` on the list), or null when it isn't deleted. */
export async function selectDeletedNote(db: Database, id: string): Promise<DeletedNote | null> {
  const [row] = await db
    .select(DELETED)
    .from(notes)
    .where(and(eq(notes.id, id), isNotNull(notes.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * «Deshacer» of a deletion: brings back exactly that note. A daily note comes back only if its day
 * has no other live note meanwhile (`dayTaken`), under the day's lock. Already live: nothing to do.
 */
export async function restoreNoteById(
  db: Database,
  id: string,
): Promise<DeletedNote | NoteFailure> {
  // A plain read (no row lock): the day never changes, and the lock must come first.
  const [note] = await db.select(DELETED).from(notes).where(eq(notes.id, id)).limit(1);
  if (!note) return "notFound";
  return db.transaction(async (tx) => {
    if (note.kind === "daily" && note.day) {
      await lockDay(tx, note.day);
      const [other] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.kind, "daily"), eq(notes.day, note.day), live, ne(notes.id, id)))
        .limit(1);
      if (other) return "dayTaken";
    }
    await tx
      .update(notes)
      .set({ deletedAt: null })
      .where(and(eq(notes.id, id), isNotNull(notes.deletedAt)));
    return note;
  });
}
