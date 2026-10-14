// «Mis nombres» (SPEC-finance-email): is a recipient the owner themself? Banks abbreviate («Jhorman J
// Bravo H» for «Jhorman Josue Bravo Huaman»), so a recipient is the owner when each of its words
// (at least two) is the start of a word of the owner's name, in the same order. Pure.

const words = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

export function isOwnName(recipient: string, ownNames: readonly string[]): boolean {
  const wanted = words(recipient);
  if (wanted.length < 2) return false;
  return ownNames.some((own) => {
    const ownWords = words(own);
    let from = 0;
    for (const word of wanted) {
      const at = ownWords.findIndex(
        (candidate, index) => index >= from && candidate.startsWith(word),
      );
      if (at === -1) return false;
      from = at + 1;
    }
    return true;
  });
}
