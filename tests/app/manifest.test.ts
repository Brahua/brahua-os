import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import manifest from "@/app/manifest";
import { pngSize } from "../../e2e/support/png";

const ROOT = path.resolve(__dirname, "../..");
const png = (file: string) => pngSize(readFileSync(path.join(ROOT, file)));

test("the manifest makes brahua-os installable and standalone", () => {
  expect(manifest()).toMatchObject({
    name: "brahua-os",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
  });
});

test("every manifest icon is a committed PNG of the declared size", () => {
  const icons = manifest().icons ?? [];
  expect(icons.map((icon) => icon.purpose)).toEqual(["any", "any", "maskable"]);
  for (const icon of icons) {
    const [width, height] = icon.sizes!.split("x").map(Number);
    expect(png(path.join("public", icon.src)), icon.src).toEqual({ width, height });
  }
});

test("the favicon and the Apple touch icon have their sizes", () => {
  expect(png("src/app/icon.png")).toEqual({ width: 32, height: 32 });
  expect(png("src/app/apple-icon.png")).toEqual({ width: 180, height: 180 });
});

test("pngSize rejects anything that is not a PNG", () => {
  expect(() => pngSize(Buffer.from("GIF89a not a png at all, really"))).toThrow("Not a PNG");
});
