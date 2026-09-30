// Validation of life area input (SPEC-core "Modelo de datos"). Client-safe: the server actions
// are the authority, and the form runs the same schema first so errors show without a round trip.
import { z } from "zod";
// Server-safe data module, not the barrel: no React in the server actions' imports.
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system/areas";

/** SPEC-core: 1–60 characters once trimmed. */
export const LIFE_AREA_NAME_MAX_LENGTH = 60;

export const LIFE_AREA_ERRORS = {
  nameRequired: "El nombre es obligatorio.",
  nameTooLong: `Usa ${LIFE_AREA_NAME_MAX_LENGTH} caracteres como máximo.`,
  color: "Elige un color.",
  icon: "Elige un ícono.",
  id: "No encontramos esta área. Recarga la página e inténtalo de nuevo.",
} as const;

const name = z
  .string({ error: LIFE_AREA_ERRORS.nameRequired })
  // Runs of whitespace (including tabs and line breaks) become one space.
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, LIFE_AREA_ERRORS.nameRequired)
      .max(LIFE_AREA_NAME_MAX_LENGTH, LIFE_AREA_ERRORS.nameTooLong),
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
