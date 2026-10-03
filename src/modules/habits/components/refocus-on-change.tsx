"use client";

import { useEffect, useRef } from "react";

/**
 * H5: after a client navigation that changes `value` (another week, another month), if the
 * focused link left with it (the first or the current one has no "anterior"/"siguiente"), focus
 * goes to `targetId` (a heading with tabIndex -1, which also says where the person is) instead
 * of <body>. Never on the first render: a page load keeps the browser's own focus.
 */
export function RefocusOnChange({ value, targetId }: { value: string; targetId: string }) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const active = document.activeElement;
    if (active === null || active === document.body) document.getElementById(targetId)?.focus();
  }, [value, targetId]);
  return null;
}
