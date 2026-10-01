// Validation of life area input (SPEC-core "Modelo de datos"). Client-safe: the server actions
// are the authority, and the form runs the same schema first so errors show without a round trip.
import { z } from "zod";
// Server-safe data module, not the barrel: no React in the server actions' imports.
import {
  AREA_COLORS,
  AREA_ICON_NAMES,
  type AreaColor,
  type AreaIconName,
} from "@/design-system/areas";

// Shared with the CHECK constraint in ./db/schema.
import { LIFE_AREA_NAME_MAX_LENGTH } from "./life-area-limits";

export { LIFE_AREA_NAME_MAX_LENGTH };

export const LIFE_AREA_ERRORS = {
  nameRequired: "El nombre es obligatorio.",
  nameTooLong: `Usa ${LIFE_AREA_NAME_MAX_LENGTH} caracteres como máximo.`,
  nameInvisible: "Quita los caracteres invisibles o de control del nombre.",
  color: "Elige un color.",
  icon: "Elige un ícono.",
  id: "No encontramos esta área. Recarga la página e inténtalo de nuevo.",
} as const;

/** What the list, the form and the actions' results get of an area (never the whole row). */
export type LifeAreaSummary = {
  id: string;
  slug: string;
  name: string;
  icon: AreaIconName;
  color: AreaColor;
  sortOrder: number;
};

/**
 * The name as stored: Unicode NFC, runs of whitespace (spaces, tabs, line breaks) as one space,
 * trimmed. The form's preview uses it too, so it shows exactly what will be saved.
 */
export function normalizeAreaName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Control and format characters (NUL, zero-width spaces, bidi overrides…) that are left after
 * normalizing. They are invisible or reorder the text, and Postgres rejects NUL outright.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;

const name = z
  .string({ error: LIFE_AREA_ERRORS.nameRequired })
  .transform(normalizeAreaName)
  .pipe(
    z
      .string()
      .min(1, LIFE_AREA_ERRORS.nameRequired)
      .max(LIFE_AREA_NAME_MAX_LENGTH, LIFE_AREA_ERRORS.nameTooLong)
      .refine((value) => !INVISIBLE.test(value), LIFE_AREA_ERRORS.nameInvisible),
  );

export const lifeAreaInputSchema = z.object({
  name,
  color: z.enum(AREA_COLORS, { error: LIFE_AREA_ERRORS.color }),
  icon: z.enum(AREA_ICON_NAMES, { error: LIFE_AREA_ERRORS.icon }),
});

export const updateLifeAreaInputSchema = lifeAreaInputSchema.extend({
  id: z.uuid({ error: LIFE_AREA_ERRORS.id }),
});

export type LifeAreaInput = z.infer<typeof lifeAreaInputSchema>;
export type UpdateLifeAreaInput = z.infer<typeof updateLifeAreaInputSchema>;
/** Field names shown in the form, in the order they appear (focus goes to the first invalid). */
export const LIFE_AREA_FIELDS = ["name", "color", "icon"] as const;
export type LifeAreaField = (typeof LIFE_AREA_FIELDS)[number];
