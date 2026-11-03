// Pure text helpers of `notes` (client-safe).

/** How long a row's excerpt may be before it is cut. */
export const EXCERPT_MAX_LENGTH = 140;

/**
 * The list's one-line excerpt: the first line with text, without Markdown's line markers (titles,
 * lists, quotes, task boxes) or emphasis marks, cut at 140 characters. Plain text: the list never
 * renders Markdown.
 */
export function excerptOf(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*/, "")
      .replace(/[*_`~]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || /^[-=|:\s]+$/.test(line)) continue;
    return line.length > EXCERPT_MAX_LENGTH
      ? `${line.slice(0, EXCERPT_MAX_LENGTH - 1).trimEnd()}…`
      : line;
  }
  return "";
}
