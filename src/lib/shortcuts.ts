// Global single-key shortcuts (SPEC-design-system "Atajos de teclado"). Pure functions, so the
// rules about when a key press counts are unit-tested without a browser.

/** Elements where a key press is text entry (or belongs to an open dialog), not a shortcut. */
const IGNORED_TARGETS = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(",");

export function isShortcutFreeTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  return element.isContentEditable || element.closest(IGNORED_TARGETS) !== null;
}

export type NavShortcut = { type: "toggle-sidebar" } | { type: "go"; index: number };

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "repeat"
  | "isComposing"
  | "defaultPrevented"
  | "target"
> & { getModifierState?: (key: string) => boolean };

/**
 * `[` toggles the sidebar and `1`–`8` go to the Nth navigation item. Nothing fires while typing
 * (inputs, textareas, contenteditable), inside a dialog, on auto-repeat or with ⌘/Ctrl/⌥.
 * The one exception: `[` is accepted with ⌥ or AltGr, because many layouts (Spanish and Latin
 * American among them) need that modifier just to type the character.
 */
export function navShortcutFor(event: ShortcutEvent): NavShortcut | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (isShortcutFreeTarget(event.target)) return null;

  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  if (event.metaKey || (event.ctrlKey && !altGraph)) return null;

  if (event.key === "[") return { type: "toggle-sidebar" };

  if (event.altKey || altGraph || event.shiftKey) return null;
  if (/^[1-8]$/.test(event.key)) return { type: "go", index: Number(event.key) - 1 };
  return null;
}
