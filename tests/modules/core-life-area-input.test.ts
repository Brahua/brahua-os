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
