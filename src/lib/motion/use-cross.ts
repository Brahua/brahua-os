"use client";

import { animate } from "motion/mini";
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";
import { bezier, EASE, SCREEN } from "./tokens";

/**
 * Panels that trade places with `hidden` (both stay mounted: they keep their state): the one that
 * becomes visible fades in and rises a few pixels. `shown` says which panel is visible; the
 * first render animates nothing. Returns a ref callback factory: `ref={panel(key)}`.
 */
export function useCrossFade<K extends string>(shown: K) {
  const elements = useRef(new Map<K, HTMLElement>());
  const previous = useRef(shown);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (previous.current === shown) return;
    previous.current = shown;
    const element = elements.current.get(shown);
    // No Web Animations (an old engine, jsdom): the panel simply appears.
    if (!element || typeof element.animate !== "function") return;
    const controls = animate(
      element,
      {
        opacity: [0, 1],
        transform: [reduced ? "none" : `translateY(${SCREEN.tabTravel}px)`, "none"],
      },
      { duration: SCREEN.tab, ease: bezier(EASE.out) },
    );
    return () => controls.cancel();
  }, [shown, reduced]);

  return (key: K) => (element: HTMLElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  };
}
