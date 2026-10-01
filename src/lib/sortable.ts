// Pieces shared by the reorderable lists built on dnd-kit (areas in C6, milestones in P3).
// Client-only.
import type { Modifier } from "@dnd-kit/core";
import { DRAGGING_ATTRIBUTE } from "./shortcuts";

/** Rows only move up and down. */
export const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** `<html data-dragging>` while a row is lifted: Esc and ⌘Z then belong to the drag. */
export function setDragging(on: boolean) {
  if (on) document.documentElement.setAttribute(DRAGGING_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(DRAGGING_ATTRIBUTE);
}
