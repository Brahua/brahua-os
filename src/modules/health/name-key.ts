// The key an exercise's name is searched and kept unique by (SPEC-health "Catálogo"). Client-safe
// and pure. Postgres' `unaccent` isn't IMMUTABLE (no index can use it), so the app computes the
// key and stores it in `name_key`; the catalogue's search folds the query the same way.

/**
 * Lowercase, without accents or marks (lowercased first, then NFD and the combining marks dropped:
 * «Ñ» → «n», and «İ», whose lowercase brings a combining dot, → «i»), runs of whitespace as one
 * space, trimmed. «Press de Banca» and «press de banca» share a key.
 */
export function exerciseNameKey(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

/** Whether an exercise's key matches a search typed by the owner (empty: everything). */
export function matchesSearch(nameKey: string, query: string): boolean {
  const key = exerciseNameKey(query);
  return key === "" || nameKey.includes(key);
}
