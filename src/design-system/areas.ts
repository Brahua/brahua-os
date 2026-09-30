import type { AreaIconName } from "./area-icons";

/**
 * Area color palettes from the design system. Each palette has a tone for the base surface
 * and an inverse tone for activated (inverted) keys, in both themes.
 * User-created areas pick one of these 8 palettes (they may share a color; the icon tells them apart).
 * No red on purpose: failing a habit must never read as an error.
 */
export const AREA_COLORS = [
  "home",
  "health",
  "finance",
  "learning",
  "work",
  "relationships",
  "travel",
  "hobbies",
] as const;

export type AreaColor = (typeof AREA_COLORS)[number];

/** Default life areas as defined in the design system (label + Lucide icon per palette). */
export const DEFAULT_AREAS: Record<AreaColor, { label: string; icon: AreaIconName }> = {
  home: { label: "Hogar", icon: "house" },
  health: { label: "Salud y Bienestar", icon: "heart-pulse" },
  finance: { label: "Finanzas", icon: "wallet" },
  learning: { label: "Aprendizaje", icon: "graduation-cap" },
  work: { label: "Trabajo", icon: "briefcase" },
  relationships: { label: "Relaciones y Familia", icon: "users" },
  travel: { label: "Planes y Viajes", icon: "plane" },
  hobbies: { label: "Hobbies", icon: "audio-waveform" },
};
