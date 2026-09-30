import type { Page } from "@playwright/test";

// Weights the screenshots render. Fonts load lazily per weight, and `document.fonts.ready` can
// resolve before a weight that only appears in a later layout (e.g. key labels at 600) has
// loaded, which made references capture the lighter fallback.
const FACES = [
  '400 15px "Archivo"',
  '500 15px "Archivo"',
  '600 15px "Archivo"',
  '700 15px "Archivo"',
  '800 15px "Archivo"',
  '500 11px "IBM Plex Mono"',
  '600 11px "IBM Plex Mono"',
];

export async function fontsLoaded(page: Page) {
  await page.evaluate(async (faces) => {
    await Promise.all(faces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
  }, FACES);
}
