import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our custom token names; otherwise it can't tell
 * `text-body` (font size) from `text-text` (color) and would drop one of them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "title",
        "title-sm",
        "body-lg",
        "body",
        "body-sm",
        "label",
        "label-xs",
        "data",
      ],
      shadow: [
        "key",
        "key-sm",
        "key-pressed",
        "key-on",
        "key-signal",
        "key-signal-pressed",
        "kbd",
        "lcd",
        "popover",
      ],
      ease: ["press", "out", "sheet", "pop"],
    },
    classGroups: {
      duration: [{ duration: ["press", "hover", "state", "sheet", "enter"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
