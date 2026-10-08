// One structured line per event, for Vercel Logs. Callers pass names, counts and codes only: never
// message text, amounts, chat ids, tokens, secrets or push keys (SPEC-reminders "Límites").
// Errors go through `describeError`, which keeps no message text either.

type Fields = Record<string, string | number | boolean | null | undefined | object>;

export function logEvent(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
