import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the design system's token names; otherwise it can't tell
 * `text-body` (font size) from `text-text` (color) and would drop one of them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "title-lg",
        "title",
        "heading",
        "subheading",
        "body",
        "body-strong",
        "body-sm",
        "caption",
        "label",
        "label-lg",
        "data-xl",
        "data-lg",
        "data",
        "kbd",
      ],
      shadow: [
        "key",
        "key-sm",
        "key-pressed",
        "key-on",
        "key-flat",
        "signal",
        "signal-pressed",
        "kbd",
        "lcd",
        "popover",
        "panel",
        "sheet",
      ],
      ease: ["press", "standard", "out", "drawer", "pop"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
