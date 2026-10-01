import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system/areas";
import {
  fail,
  INVALID_FIELDS_MESSAGE,
  ok,
  unauthorized,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/action-result";
import {
  LIFE_AREA_ERRORS,
  LIFE_AREA_NAME_MAX_LENGTH,
  lifeAreaInputSchema,
  normalizeAreaName,
  updateLifeAreaInputSchema,
} from "@/modules/core/life-area-input";

const valid = { name: "Música", color: "hobbies", icon: "music" };

describe("lifeAreaInputSchema", () => {
  test("accepts every palette and every curated icon", () => {
    for (const color of AREA_COLORS) {
      expect(lifeAreaInputSchema.safeParse({ ...valid, color }).success).toBe(true);
    }
    for (const icon of AREA_ICON_NAMES) {
      expect(lifeAreaInputSchema.safeParse({ ...valid, icon }).success).toBe(true);
    }
  });

  test("trims the name and collapses inner whitespace", () => {
    const parsed = lifeAreaInputSchema.parse({ ...valid, name: "\t Salud \n y   bienestar  " });
    expect(parsed.name).toBe("Salud y bienestar");
  });

  test("drops unknown keys", () => {
    const parsed = lifeAreaInputSchema.parse({ ...valid, slug: "x", sortOrder: 3 });
    expect(parsed).toEqual(valid);
  });

  test.each([
    ["", LIFE_AREA_ERRORS.nameRequired],
    ["    ", LIFE_AREA_ERRORS.nameRequired],
    [undefined, LIFE_AREA_ERRORS.nameRequired],
    [42, LIFE_AREA_ERRORS.nameRequired],
    ["a".repeat(LIFE_AREA_NAME_MAX_LENGTH + 1), LIFE_AREA_ERRORS.nameTooLong],
  ])("name %j → %s", (name, message) => {
    const result = lifeAreaInputSchema.safeParse({ ...valid, name });
    expect(result.success).toBe(false);
    expect(z.flattenError(result.error!).fieldErrors).toEqual({ name: [message] });
  });

  test("60 characters is fine, counted after trimming", () => {
    const name = "ñ".repeat(LIFE_AREA_NAME_MAX_LENGTH);
    expect(lifeAreaInputSchema.safeParse({ ...valid, name: ` ${name} ` }).success).toBe(true);
  });

  test.each([
    ["color", "red", LIFE_AREA_ERRORS.color],
    ["color", undefined, LIFE_AREA_ERRORS.color],
    ["icon", "skull", LIFE_AREA_ERRORS.icon],
    ["icon", "", LIFE_AREA_ERRORS.icon],
    ["icon", "House", LIFE_AREA_ERRORS.icon],
  ])("%s %j → %s", (field, value, message) => {
    const result = lifeAreaInputSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(z.flattenError(result.error!).fieldErrors).toEqual({ [field]: [message] });
  });
});

describe("name hygiene", () => {
  test.each([
    ["NUL", "\u0000"],
    ["NUL inside", "Mú\u0000sica"],
    ["zero-width space", "\u200B"],
    ["zero-width space inside", "Mú\u200Bsica"],
    ["right-to-left override", "a\u202Eb"],
    ["left-to-right embedding", "a\u202Ab"],
    ["soft hyphen", "Mú\u00ADsica"],
    ["bell", "a\u0007b"],
  ])("rejects a %s", (_, name) => {
    const result = lifeAreaInputSchema.safeParse({ ...valid, name });
    expect(result.success).toBe(false);
    expect(z.flattenError(result.error!).fieldErrors.name).toEqual([
      LIFE_AREA_ERRORS.nameInvisible,
    ]);
  });

  test.each([
    ["family (ZWJ sequence)", "Familia 👨\u200D👩\u200D👧"],
    ["rainbow flag (ZWJ + variation selector)", "Orgullo 🏳\uFE0F\u200D🌈"],
    ["zero-width non-joiner", "می\u200Cخواهم"],
  ])("accepts a %s", (_, name) => {
    expect(lifeAreaInputSchema.parse({ ...valid, name }).name).toBe(name);
  });

  test("NUL, U+200B and U+202E are still rejected next to an allowed ZWJ", () => {
    for (const bad of ["\u0000", "\u200B", "\u202E"]) {
      const result = lifeAreaInputSchema.safeParse({ ...valid, name: `👨\u200D👩${bad}x` });
      expect(result.success).toBe(false);
      expect(z.flattenError(result.error!).fieldErrors.name).toEqual([
        LIFE_AREA_ERRORS.nameInvisible,
      ]);
    }
  });

  test("tabs and line breaks are whitespace, not errors", () => {
    expect(lifeAreaInputSchema.parse({ ...valid, name: "a\tb\r\nc" }).name).toBe("a b c");
  });

  test("normalizeAreaName: NFC, collapsed whitespace, trimmed", () => {
    expect(normalizeAreaName("  Me\u0301xico \n  lindo ")).toBe("México lindo");
    expect(normalizeAreaName("Me\u0301xico")).toHaveLength(6);
    expect(normalizeAreaName("\u00A0 Viajes\u3000")).toBe("Viajes");
  });
});

describe("updateLifeAreaInputSchema", () => {
  test("needs a uuid id", () => {
    const id = "3f2b6a1e-8c4d-4e5f-9a0b-1c2d3e4f5a6b";
    expect(updateLifeAreaInputSchema.parse({ ...valid, id })).toEqual({ ...valid, id });
    const result = updateLifeAreaInputSchema.safeParse({ ...valid, id: "home" });
    expect(z.flattenError(result.error!).fieldErrors).toEqual({ id: [LIFE_AREA_ERRORS.id] });
  });
});

describe("ActionResult helpers", () => {
  test("ok wraps the data", () => {
    expect(ok({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });

  test("fail with a message", () => {
    expect(fail("Algo pasó")).toEqual({ ok: false, error: "Algo pasó" });
    expect(unauthorized()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
  });

  test("fail with a ZodError lists every field's messages", () => {
    const result = lifeAreaInputSchema.safeParse({ name: "", color: "x", icon: "y" });
    expect(fail(result.error!)).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: {
        name: [LIFE_AREA_ERRORS.nameRequired],
        color: [LIFE_AREA_ERRORS.color],
        icon: [LIFE_AREA_ERRORS.icon],
      },
    });
  });

  test("errors without a path (a non-object payload) go under _form", () => {
    const result = lifeAreaInputSchema.safeParse(null);
    const failed = fail(result.error!);
    expect(failed).toMatchObject({ ok: false, error: INVALID_FIELDS_MESSAGE });
    expect(failed.ok === false && Object.keys(failed.fieldErrors ?? {})).toEqual(["_form"]);
  });
});
