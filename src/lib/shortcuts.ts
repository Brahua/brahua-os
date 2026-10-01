// Global single-key shortcuts (SPEC-design-system "Atajos de teclado"). Pure functions, so the
// rules about when a key press counts are unit-tested without a browser.

/** Inputs that take typed text. Checkboxes, radios, buttons, ranges… don't, so keys stay free. */
const NON_TEXT_INPUT_TYPES = [
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
  "hidden",
];

/**
 * Elements where a key press is text entry or drives a widget of its own (lists, menus, grids,
 * sliders…), or belongs to an open dialog: there a key is never a navigation shortcut.
 */
const IGNORED_TARGETS = [
  `input${NON_TEXT_INPUT_TYPES.map((type) => `:not([type="${type}" i])`).join("")}`,
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(",");

export function isShortcutFreeTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  return element.isContentEditable || element.closest(IGNORED_TARGETS) !== null;
}

export type NavShortcut = { type: "toggle-sidebar" } | { type: "go"; digit: number };

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
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
 * `[` toggles the sidebar and `1`–`8` go to the section with that number. Nothing fires while
 * typing or inside a widget/dialog (see IGNORED_TARGETS), on auto-repeat, or with ⌘/Ctrl/Shift.
 * Two ⌥ cases are accepted on purpose:
 * - `[` with ⌥ or AltGr: many layouts (Spanish and Latin American among them) need that
 *   modifier just to type the character.
 * - ⌥ + digit (matched by physical key, `Digit1`…): an alternative to the bare digit.
 */
export function navShortcutFor(event: ShortcutEvent): NavShortcut | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (isShortcutFreeTarget(event.target)) return null;

  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  if (event.metaKey || (event.ctrlKey && !altGraph)) return null;

  if (event.key === "[") return { type: "toggle-sidebar" };
  if (event.shiftKey || altGraph) return null;

  if (event.altKey) {
    // ⌥ changes `key` ("¡" on a Mac), so use the physical key.
    const match = /^Digit([1-8])$/.exec(event.code);
    return match ? { type: "go", digit: Number(match[1]) } : null;
  }
  if (/^[1-8]$/.test(event.key)) return { type: "go", digit: Number(event.key) };
  return null;
}

/**
 * ⌘Z (Mac) or Ctrl+Z: run the "Deshacer" of the notice on screen. Not while typing or inside a
 * widget or dialog (the field's own undo wins there), nor with Shift (redo) or ⌥. A modifier
 * shortcut, so the single-key switch (WCAG 2.1.4) does not apply.
 */
export function isUndoShortcut(event: ShortcutEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.metaKey === event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.key.toLowerCase() !== "z") return false;
  return !isShortcutFreeTarget(event.target);
}
