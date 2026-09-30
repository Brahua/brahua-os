// Server-safe area data: plain values only (no React, no lucide-react), so the database schema,
// drizzle-kit and scripts can import it. Icon components live in ./area-icons.

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

/**
 * Names of the curated Lucide icons for life areas (see AREA_ICONS in ./area-icons).
 * Stored in the database, so never rename an existing name.
 * Usable in `z.enum(AREA_ICON_NAMES)` and Drizzle text enums.
 */
export const AREA_ICON_NAMES = [
  "house",
  "heart-pulse",
  "wallet",
  "graduation-cap",
  "briefcase",
  "users",
  "plane",
  "audio-waveform",
  "apple",
  "baby",
  "bike",
  "book-open",
  "brain",
  "calendar",
  "camera",
  "car",
  "cat",
  "code",
  "coffee",
  "dog",
  "dumbbell",
  "film",
  "flower",
  "gamepad",
  "globe",
  "guitar",
  "headphones",
  "heart",
  "landmark",
  "laptop",
  "leaf",
  "lightbulb",
  "map",
  "mic",
  "moon",
  "mountain",
  "music",
  "palette",
  "pen-tool",
  "piggy-bank",
  "pill",
  "rocket",
  "shield",
  "shopping-cart",
  "sparkles",
  "sprout",
  "star",
  "stethoscope",
  "sun",
  "target",
  "tent",
  "trending-up",
  "trophy",
  "utensils",
  "wrench",
] as const;

export type AreaIconName = (typeof AREA_ICON_NAMES)[number];

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
