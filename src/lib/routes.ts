// App-wide URLs that belong to no single module. Client-safe.

/**
 * The home page ("Hoy"): the `today` board, where `habits`, `tasks` and `projects` show what is
 * due today. Their actions revalidate it so the board never shows stale data (SPEC-today
 * "Revalidación").
 */
export const HOME_PATH = "/";
