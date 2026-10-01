// Ordering helpers for life areas, shared by the server (validating a reorder) and the client
// (optimistic moves). Client-safe: no server code.

/** `ids` with the item at `from` moved to `to` (both clamped to the list). A new array. */
export function moveId<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** True when both lists hold exactly the same ids (any order, no duplicates). */
export function isSameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length || new Set(b).size !== b.length) return false;
  return b.every((id) => set.has(id));
}

type OrderedRow = { id: string; archived: boolean };

/**
 * The full order to write when the owner reorders the active areas: the submitted active ids
 * first, then the archived ones in their current order. Every area gets a position, so
 * `sort_order` ends up contiguous (0…n-1) and unique.
 *
 * Returns null when `submitted` is not exactly the set of active areas: the list on screen was
 * stale (an area was created, archived or restored elsewhere) or the request was tampered with.
 */
export function planReorder(
  current: readonly OrderedRow[],
  submitted: readonly string[],
): string[] | null {
  const active = current.filter((row) => !row.archived).map((row) => row.id);
  if (!isSameIdSet(active, submitted)) return null;
  const archived = current.filter((row) => row.archived).map((row) => row.id);
  return [...submitted, ...archived];
}

/**
 * Puts `items` in the order of `ids`. Items missing from `ids` (e.g. one created while a move
 * was in flight) keep their relative order after the ordered ones; unknown ids are ignored.
 */
export function applyOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]) {
  const position = new Map(ids.map((id, index) => [id, index]));
  const known = items.filter((item) => position.has(item.id));
  const rest = items.filter((item) => !position.has(item.id));
  known.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return [...known, ...rest];
}
