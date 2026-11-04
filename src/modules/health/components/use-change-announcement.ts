"use client";

import { useEffect, useRef } from "react";
import { useAnnouncer } from "@/modules/core/components/screen-services";

/**
 * What a search list shows («12 ejercicios.», none), said by a polite announcer only when it
 * changes: not on the first render, nor again on each keystroke that brings as many rows (as
 * the notes' link picker). Returns the text for the caller's `role="status"` region, which goes
 * where the screen reader can hear it (inside a sheet, for the picker).
 */
export function useChangeAnnouncement(message: string): string {
  const [announcement, announce] = useAnnouncer();
  const last = useRef(message);
  useEffect(() => {
    if (last.current === message) return;
    last.current = message;
    announce(message);
  }, [message, announce]);
  return announcement;
}
