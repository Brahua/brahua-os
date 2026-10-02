// Tags of tasks (T4, SPEC-tasks "Etiquetas"): free, optional, several per task, created when
// first typed. Client-safe: the tag field runs the same rules before sending, and the server
// actions are the authority.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { TASK_TAG_NAME_MAX_LENGTH, TASK_TAGS_MAX } from "./task-constants";
import { TAGS_COPY } from "./tags-copy";

export { TASK_TAG_NAME_MAX_LENGTH, TASK_TAGS_MAX } from "./task-constants";

/** `?etiqueta=<tagId>` filters the "Todas" view by a tag (by id: stable under a rename). */
export const TAG_PARAM = "etiqueta";

/**
 * A tag as stored: lowercase (the database checks `name = lower(name)`), then like names (NFC,
 * runs of whitespace as one space, trimmed). NFC goes last: lowercasing can leave a decomposed
 * sequence (e.g. "İ" → "i" + U+0307).
 */
export function normalizeTagName(value: string): string {
  return normalizeName(value.toLowerCase());
}

/** Length in characters as Postgres counts them (code points, not UTF-16 units). */
const codePoints = (value: string) => [...value].length;

/**
 * Why a normalized tag name is refused, or null when it is fine: empty, longer than 30, with a
 * comma (the separator), or with control or format characters (bidi overrides, zero-width…).
 */
export function tagNameProblem(name: string): string | null {
  if (name === "") return TAGS_COPY.errors.empty;
  if (codePoints(name) > TASK_TAG_NAME_MAX_LENGTH) return TAGS_COPY.errors.tooLong;
  if (name.includes(",")) return TAGS_COPY.errors.comma;
  if (hasInvisibleCharacters(name)) return TAGS_COPY.errors.invisible;
  return null;
}

/** One tag name: normalized, then checked. */
export const tagNameSchema = z
  .string({ error: TAGS_COPY.errors.empty })
  // Bounded before normalizing: nothing near this is a tag (it never reaches Postgres).
  .max(200, TAGS_COPY.errors.tooLong)
  .transform(normalizeTagName)
  .superRefine((name, context) => {
    const problem = tagNameProblem(name);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

/** A bound on the list as sent, before deduplicating (nothing legitimate comes near it). */
const RAW_TAGS_MAX = 50;

/**
 * A task's tags: a set of names (duplicates after normalizing count once, in the order first
 * given), at most 10 once deduplicated.
 */
export const taskTagsSchema = z
  .array(tagNameSchema, { error: TAGS_COPY.errors.list })
  .max(RAW_TAGS_MAX, TAGS_COPY.errors.tooMany)
  .transform((names) => [...new Set(names)])
  .pipe(z.array(z.string()).max(TASK_TAGS_MAX, TAGS_COPY.errors.tooMany));

/** `setTaskTags`: a task and its whole set of tags. */
export const setTaskTagsInputSchema = z.object({
  // task-input.ts imports this file (capture's tags), so not its TASK_ERRORS: same text.
  id: z.uuid({ error: TAGS_COPY.errors.taskNotFound }),
  tags: taskTagsSchema,
});

/**
 * The suggestions for what is being typed: the known tags not on the task yet that contain it,
 * the ones that start with it first (then in the given order: the most used first). With nothing
 * typed, the first ones as given.
 */
export function suggestTags(
  known: readonly string[],
  query: string,
  chosen: readonly string[],
  limit = 6,
): string[] {
  const typed = normalizeTagName(query);
  const taken = new Set(chosen);
  const free = known.filter((name) => !taken.has(name));
  if (typed === "") return free.slice(0, limit);
  const starts = free.filter((name) => name.startsWith(typed));
  const contains = free.filter((name) => !name.startsWith(typed) && name.includes(typed));
  return [...starts, ...contains].slice(0, limit);
}
