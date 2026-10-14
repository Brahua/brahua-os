"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { createContext, use } from "react";

const MotionEnabledContext = createContext(false);

/**
 * True under a `MotionProvider`. Components that animate read it and render plain, static markup
 * without one: that keeps unit tests, error pages and any screen that has not adopted the
 * contract free of animation state.
 */
export function useMotionEnabled(): boolean {
  return use(MotionEnabledContext);
}

const loadAnimation = () => import("./features").then((loaded) => loaded.domAnimation);
const loadMax = () => import("./features").then((loaded) => loaded.domMax);

type MotionProviderProps = {
  /**
   * `sync` (default): `domAnimation` in the bundle, so the first paint animates at once (a screen
   * whose entry must not wait for a download). `lazy`: `domAnimation` by dynamic import. `max`:
   * `domMax` by dynamic import, for `layout` and drag. Pick the lightest that covers the screen.
   */
  features?: "sync" | "lazy" | "max";
  children: React.ReactNode;
};

/**
 * One decision point for the motion of a screen (SPEC-finance-motion, "Contrato de movimiento"):
 * the animation features and `reducedMotion="user"`, which makes Motion keep opacity and colour
 * and skip transforms and layout animations when the device asks for less motion. Animations
 * that do not go through Motion (`animate()` from `motion/mini`, SVG strokes, widths) read
 * `usePrefersReducedMotion` themselves.
 */
export function MotionProvider({ features = "sync", children }: MotionProviderProps) {
  const loader = features === "sync" ? domAnimation : features === "max" ? loadMax : loadAnimation;
  return (
    <MotionEnabledContext value={true}>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loader}>{children}</LazyMotion>
      </MotionConfig>
    </MotionEnabledContext>
  );
}
