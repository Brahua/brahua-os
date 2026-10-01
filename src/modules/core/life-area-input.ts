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
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";

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
  archived: "Esta área está archivada. Desarchívala para editarla.",
  order: "El orden enviado no es válido. Recarga la página e inténtalo de nuevo.",
  staleOrder:
    "La lista de áreas cambió mientras la ordenabas. Ya está al día: vuelve a intentarlo.",
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
export const normalizeAreaName = normalizeName;

const name = z
  .string({ error: LIFE_AREA_ERRORS.nameRequired })
  .transform(normalizeAreaName)
  .pipe(
    z
      .string()
      .min(1, LIFE_AREA_ERRORS.nameRequired)
      .max(LIFE_AREA_NAME_MAX_LENGTH, LIFE_AREA_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), LIFE_AREA_ERRORS.nameInvisible),
  );

export const lifeAreaInputSchema = z.object({
  name,
  color: z.enum(AREA_COLORS, { error: LIFE_AREA_ERRORS.color }),
  icon: z.enum(AREA_ICON_NAMES, { error: LIFE_AREA_ERRORS.icon }),
});

const areaId = z.uuid({ error: LIFE_AREA_ERRORS.id });

export const updateLifeAreaInputSchema = lifeAreaInputSchema.extend({ id: areaId });

/** Archive or unarchive: just the area. */
export const lifeAreaIdInputSchema = z.object({ id: areaId });

/**
 * Unarchive. `end` (the default) puts the area after every active one; `original` keeps its
 * old position, which is how "Deshacer" undoes an archive (archiving keeps `sort_order`).
 */
export const unarchiveLifeAreaInputSchema = lifeAreaIdInputSchema.extend({
  position: z.enum(["end", "original"]).default("end"),
});

/** Far above any real list; bounds the work a single request can ask for. */
export const MAX_LIFE_AREAS_IN_ORDER = 500;

/**
 * Reorder: every active area's id, in the new order. The action also checks that they are
 * exactly the active areas (see `planReorder`).
 */
export const reorderLifeAreasInputSchema = z.object({
  ids: z
    .array(z.uuid({ error: LIFE_AREA_ERRORS.order }), { error: LIFE_AREA_ERRORS.order })
    .min(1, LIFE_AREA_ERRORS.order)
    .max(MAX_LIFE_AREAS_IN_ORDER, LIFE_AREA_ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, LIFE_AREA_ERRORS.order),
});

export type LifeAreaInput = z.infer<typeof lifeAreaInputSchema>;
export type UpdateLifeAreaInput = z.infer<typeof updateLifeAreaInputSchema>;
export type UnarchiveLifeAreaInput = z.output<typeof unarchiveLifeAreaInputSchema>;
/** Field names shown in the form, in the order they appear (focus goes to the first invalid). */
export const LIFE_AREA_FIELDS = ["name", "color", "icon"] as const;
export type LifeAreaField = (typeof LIFE_AREA_FIELDS)[number];
