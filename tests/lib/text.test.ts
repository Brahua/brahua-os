import { describe, expect, test } from "vitest";
import { FALLBACK_SLUG, slugify, uniqueSlug } from "@/lib/text";

describe("slugify", () => {
  test.each([
    ["Hogar", "hogar"],
    ["Salud y Bienestar", "salud-y-bienestar"],
    ["Educación", "educacion"],
    ["Música", "musica"],
    ["ÁÉÍÓÚ áéíóú Üü", "aeiou-aeiou-uu"],
    ["Año nuevo", "ano-nuevo"],
    ["ÑANDÚ", "nandu"],
    ["Straße", "strasse"],
    ["Finanzas & Inversiones", "finanzas-inversiones"],
    ["  Viajes  / Planes!! ", "viajes-planes"],
    ["C++ y Rust", "c-y-rust"],
    ["Trabajo 2026", "trabajo-2026"],
    ["Café ☕ y libros 📚", "cafe-y-libros"],
    ["--ya--con--guiones--", "ya-con-guiones"],
    ["tab\there\nnewline", "tab-here-newline"],
    ["Ｆｕｌｌ ｗｉｄｔｈ", "full-width"],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test("falls back when nothing usable is left", () => {
    expect(slugify("")).toBe(FALLBACK_SLUG);
    expect(slugify("¡¿?!")).toBe(FALLBACK_SLUG);
    expect(slugify("🎸🎹")).toBe(FALLBACK_SLUG);
    expect(slugify("日本語")).toBe(FALLBACK_SLUG);
    expect(slugify("💡", "area")).toBe("area");
  });

  test("only ever returns lowercase ASCII letters, digits and single inner hyphens", () => {
    for (const input of ["Ça va?", "  É  ", "a—b–c", "x__y", "Ω mega"]) {
      expect(slugify(input)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("uniqueSlug", () => {
  test("keeps the base when it is free", () => {
    expect(uniqueSlug("musica", new Set(["home"]))).toBe("musica");
  });

  test("adds -2, -3… until free", () => {
    expect(uniqueSlug("home", new Set(["home"]))).toBe("home-2");
    expect(uniqueSlug("home", new Set(["home", "home-2", "home-3"]))).toBe("home-4");
    // Gaps are reused.
    expect(uniqueSlug("home", new Set(["home", "home-3"]))).toBe("home-2");
  });
});
